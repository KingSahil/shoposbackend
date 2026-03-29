import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, getDocs, query, where, updateDoc, deleteDoc, doc, setDoc, getDoc, writeBatch, increment } from 'firebase/firestore';

// 🛠️ FIREBASE CONFIG (Provided by User)
const firebaseConfig = { 
  apiKey: "AIzaSyDL1BDF5M78MWd_E35UEz31lXBxbI3hpDE", 
  authDomain: "kiranakeeper.firebaseapp.com", 
  projectId: "kiranakeeper", 
  storageBucket: "kiranakeeper.firebasestorage.app", 
  messagingSenderId: "961575852149", 
  appId: "1:961575852149:web:112391cf89ba751717403c", 
  measurementId: "G-RBD63NGY6Z" 
}; 

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// 🎯 MERCHANT CONFIG (Verified via User)
const MERCHANT_EMAIL = 'sahilgupta1750@gmail.com';
const MERCHANT_USER_ID = '34vSO0JZsZPuXL6jlviszlzwe3Y2'; // Fixed to correct account

/**
 * Get the current merchant's user ID.
 */
async function getMerchantUserId() {
  console.log(`🎯 [FIREBASE] Using verified Merchant UID: ${MERCHANT_USER_ID}`);
  return MERCHANT_USER_ID;
}

/**
 * Bot Status
 */
export async function updateBotStatusInFirebase(status) {
  try {
    const userId = await getMerchantUserId();
    const statusRef = doc(db, `users/${userId}/bot/status`);
    await setDoc(statusRef, { ...status, updatedAt: new Date().toISOString() }, { merge: true });
    console.log("✅ [FIREBASE] Bot status updated!");
  } catch (error) {
    console.error("❌ [FIREBASE] Error updating bot status:", error.message);
  }
}

/**
 * Save Order & Update Stock
 */
export async function saveOrderToFirebase({ phone, items, totalAmount, customerName, paymentStatus = 'Pending' }) {
  console.log(`🚀 [FIREBASE] Saving Order for: ${customerName}`);
  try {
    const userId = await getMerchantUserId();
    const ordersRef = collection(db, `users/${userId}/orders`);
    const cleanPhone = phone.replace(/\D/g, '');
    
    const descriptions = items.map((item, i) => i === items.length - 1 ? item.description : item.description + ',').join(' ');

    const orderDoc = {
      id: `#ORD-${Math.floor(10000 + Math.random() * 90000)}`,
      name: descriptions || 'Custom Order',
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      timestamp: new Date().getTime(),
      customer: customerName ? `${customerName} (${cleanPhone})` : `Phone: +${cleanPhone}`,
      phone: cleanPhone,
      initials: customerName ? customerName.substring(0, 2).toUpperCase() : 'WA',
      status: paymentStatus === 'Paid' ? 'Paid' : 'Pending',
      amount: `${totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      sColor: paymentStatus === 'Paid' ? 'tertiary' : 'secondary',
      items: items
    };
    
    const docRef = await addDoc(ordersRef, orderDoc);
    console.log(`✅ [FIREBASE] Order saved to users/${userId}/orders/${docRef.id}`);

    // Batch update stock
    const batch = writeBatch(db);
    for (const item of items) {
      if (!item.id) continue;
      const itemRef = doc(db, `users/${userId}/inventory/${item.id}`);
      const itemSnap = await getDoc(itemRef);
      const qty = item.quantity || 1;
      const estStock = Math.max(0, (item.stock || 0) - qty);
      const status = estStock < 20 ? 'error' : 'tertiary';

      if (itemSnap.exists()) {
        batch.update(itemRef, { stock: increment(-qty), status });
      } else {
        batch.set(itemRef, {
          id: item.id,
          name: item.description,
          description: item.description,
          price: item.price * (item.stock || 1),
          unitPrice: item.price,
          stock: (item.stock || 0) - qty,
          sku: item.sku || `SKU-${item.id}`,
          status,
          category: 'Essentials'
        });
      }
    }
    await batch.commit();
    console.log("✅ [FIREBASE] Stock updated!");
    return true;
  } catch (error) {
    console.error("❌ [FIREBASE] Error saving order:", error.message);
    return false;
  }
}

/**
 * Save Udhaar / Transaction
 */
export async function saveUdharToFirebase({ phone, customerName, amount }) {
  console.log(`🚀 [FIREBASE] Recording Udhar for: ${customerName} (₹${amount})`);
  
  try {
    const userId = await getMerchantUserId();
    const cleanPhone = phone.replace(/\D/g, '');
    
    // 1. Add to 'transactions' collection (for the ledger list)
    const transactionsRef = collection(db, `users/${userId}/transactions`);
    const newTransaction = {
      id: `#TXN-${Math.floor(10000 + Math.random() * 90000)}`,
      name: customerName,
      customer: `${customerName} (${cleanPhone})`,
      phone: cleanPhone,
      initials: customerName.substring(0, 2).toUpperCase(),
      type: 'Credit',
      amount: amount.toLocaleString('en-IN'),
      status: 'Pending',
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      timestamp: new Date().getTime(),
      lastUpdated: new Date().toISOString()
    };
    
    const txnDoc = await addDoc(transactionsRef, newTransaction);
    console.log(`✅ [FIREBASE] Transaction saved to users/${userId}/transactions/${txnDoc.id}`);

    // 2. Update/Create summary in 'udhar' collection (for summary cards)
    const udharRef = collection(db, `users/${userId}/udhar`);
    
    // Search by phone first, then by name
    const qByPhone = query(udharRef, where("phone", "==", cleanPhone));
    const qByName = query(udharRef, where("name", "==", customerName));
    
    const [snapPhone, snapName] = await Promise.all([
      getDocs(qByPhone),
      getDocs(qByName)
    ]);

    const existingDoc = !snapPhone.empty ? snapPhone.docs[0] : (!snapName.empty ? snapName.docs[0] : null);

    if (existingDoc) {
      const docRef = existingDoc.ref;
      const data = existingDoc.data();
      const currentAmount = parseFloat(data.amount?.toString().replace(/,/g, '') || '0');
      const newAmount = currentAmount + amount;
      
      await updateDoc(docRef, {
        amount: newAmount.toLocaleString('en-IN'),
        phone: cleanPhone,
        lastUpdated: new Date().toISOString(),
        serverTimestamp: new Date().getTime()
      });
      console.log(`🔄 [FIREBASE] Summary Udhar updated in users/${userId}/udhar/${docRef.id}`);
    } else {
      const newSummary = {
        name: customerName,
        initials: customerName.substring(0, 2).toUpperCase(),
        lastPayment: 'Never',
        amount: amount.toLocaleString('en-IN'),
        bg: 'bg-secondary-fixed',
        text: 'text-on-secondary-container',
        phone: cleanPhone,
        lastUpdated: new Date().toISOString(),
        serverTimestamp: new Date().getTime()
      };
      const summaryDoc = await addDoc(udharRef, newSummary);
      console.log(`➕ [FIREBASE] New Summary Udhar created in users/${userId}/udhar/${summaryDoc.id}`);
    }

    return true;
  } catch (error) {
    console.error("❌ [FIREBASE] Error saving Udhar:", error.message);
    return false;
  }
}

/**
 * Cancel Order
 */
export async function cancelLastOrderFromFirebase(phone) {
  try {
    const userId = await getMerchantUserId();
    const cleanPhone = phone.replace(/\D/g, ''); 
    const ordersRef = collection(db, `users/${userId}/orders`);
    const snap = await getDocs(ordersRef);
    const orders = snap.docs.map(d => ({ ref: d.ref, ...d.data() }))
      .filter(o => String(o.phone || "").replace(/\D/g, '') === cleanPhone)
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (orders.length > 0) {
      await deleteDoc(orders[0].ref);
      console.log(`✅ [FIREBASE] Canceled order for ${cleanPhone} in users/${userId}/orders`);
      return true;
    }
    return false;
  } catch (error) {
    console.error("❌ [FIREBASE] Cancel failed:", error.message);
    return false;
  }
}

/**
 * Fetch Inventory (Always from Website API)
 */
const WEBSITE_API_BASE_URL = 'http://localhost:3000/api';

export async function fetchInventoryFromWebsite() {
  try {
    const response = await fetch(`${WEBSITE_API_BASE_URL}/inventory?t=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data.map(item => ({
      id: String(item.id || item.sku || item.name || '').trim(),
      description: String(item.name || item.description || '').trim() || 'Unnamed Item',
      price: Number(item.unitPrice || item.price || 0),
      stock: Math.max(0, Number(item.stock || 0)),
      sku: String(item.sku || item.code || '').trim(),
    })).filter(i => i.id);
  } catch (error) {
    console.error("❌ [API] Fetch failed:", error.message);
    return [];
  }
}

export async function fetchMenuFromFirebase() {
  const items = await fetchInventoryFromWebsite();
  const menu = {};
  items.forEach((item, idx) => menu[String(idx + 1)] = item);
  return menu;
}

export async function validateInventoryAvailability(items) {
  const inv = await fetchInventoryFromWebsite();
  const map = new Map(inv.map(i => [i.id, i]));
  for (const item of items) {
    const invItem = map.get(item.id);
    if (!invItem || (item.quantity || 1) > invItem.stock) return { ok: false, message: `Insufficient stock for ${item.description}` };
  }
  return { ok: true };
}

export async function fetchAdminSummaryData() {
  const inventory = await fetchInventoryFromWebsite();
  return { orders: [], inventory, udhar: [] };
}
