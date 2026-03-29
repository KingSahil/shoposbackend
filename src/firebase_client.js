import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, collection, addDoc, getDocs, collectionGroup, query, where, updateDoc, deleteDoc, orderBy, limit, doc, setDoc, getDoc, writeBatch, increment, Timestamp } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDL1BDF5M78MWd_E35UEz31lXBxbI3hpDE",
  authDomain: "kiranakeeper.firebaseapp.com",
  projectId: "kiranakeeper",
  storageBucket: "kiranakeeper.firebasestorage.app",
  messagingSenderId: "961575852149",
  appId: "1:961575852149:web:112391cf89ba751717403c",
  measurementId: "G-RBD63NGY6Z"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
export const db = getFirestore(app);

const WEBSITE_API_BASE_URL = String(process.env.WEBSITE_API_BASE_URL || 'http://localhost:3000/api').replace(/\/$/, '');

let isAuthenticated = false;

async function authenticateFirebase() {
  if (isAuthenticated) return true;
  const email = process.env.FIREBASE_EMAIL;
  const password = process.env.FIREBASE_PASSWORD;
  
  if (!email || !password) {
    console.error("Firebase email or password missing in .env. Cannot sync orders to website.");
    return false;
  }
  
  try {
    await signInWithEmailAndPassword(auth, email, password);
    isAuthenticated = true;
    console.log("Logged into Firebase successfully.");
    return true;
  } catch (error) {
    console.error("Firebase authentication failed:", error);
    return false;
  }
}

export async function resolveStoreUserId() {
  const explicitUserId = String(process.env.FIREBASE_USER_ID || '').trim();
  if (explicitUserId) {
    return explicitUserId;
  }

  const authenticated = await authenticateFirebase();
  if (authenticated && auth.currentUser?.uid) {
    return auth.currentUser.uid;
  }

  const inventoryGroupRef = collectionGroup(db, 'inventory');
  const inventorySnap = await getDocs(inventoryGroupRef);
  if (inventorySnap.empty) {
    return null;
  }

  return inventorySnap.docs[0].ref.path.split('/')[1];
}

function normalizeInventoryItem(item) {
  if (!item || typeof item !== 'object') return null;

  const id = String(item.id || item.sku || item.name || '').trim();
  if (!id) return null;

  const resolvedName = String(item.name || item.description || '').trim() || 'Unnamed Item';
  const resolvedUnitPrice = Number(item.unitPrice || item.price || 0) || 0;

  return {
    id,
    name: resolvedName,
    description: resolvedName,
    price: resolvedUnitPrice,
    unitPrice: resolvedUnitPrice,
    stock: Math.max(0, Number(item.stock || 0)),
    sku: String(item.sku || item.code || '').trim(),
  };
}

export async function fetchInventoryFromWebsite() {
  try {
    const response = await fetch(`${WEBSITE_API_BASE_URL}/inventory`, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`Website inventory fetch failed with status ${response.status}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error('Website inventory endpoint did not return an array');
    }

    return data
      .map(normalizeInventoryItem)
      .filter(Boolean);
  } catch (error) {
    console.error('Error fetching inventory from Website API:', error);
    return [];
  }
}

export async function fetchMenuFromFirebase() {
  // Switched to website API inventory source
  try {
    const inventory = await fetchInventoryFromWebsite();
    if (!inventory.length) {
      console.warn('No inventory items from website API.');
      return {};
    }

    const menuObj = {};
    inventory.forEach((item, idx) => {
      menuObj[String(idx + 1)] = item;
    });

    console.log(`Fetched ${Object.keys(menuObj).length} items from Website API.`);
    return menuObj;
  } catch (error) {
    console.error('Error fetching menu from Website API:', error);
    return null;
  }
}

export async function validateInventoryAvailability(items) {
  try {
    const inventory = await fetchInventoryFromWebsite();
    if (!inventory.length) {
      return {
        ok: false,
        code: 'inventory_missing',
        message: 'Inventory is not available right now.'
      };
    }

    const invMap = new Map(inventory.map(i => [i.id, i]));

    for (const item of items) {
      if (!item?.id) {
        return {
          ok: false,
          code: 'item_missing',
          message: `"${item?.description || 'This item'}" is not available in the inventory right now.`
        };
      }

      const invItem = invMap.get(item.id);
      if (!invItem) {
        return {
          ok: false,
          code: 'item_missing',
          message: `"${item.description}" is not available in the inventory right now.`
        };
      }

      const availableStock = Math.max(0, Number(invItem.stock || 0));
      const qty = Math.max(1, Number(item.quantity) || 1);
      if (qty > availableStock) {
        return {
          ok: false,
          code: 'insufficient_stock',
          message: `Only ${availableStock} units of ${invItem.description || item.description} are left in inventory. Please reduce the quantity.`
        };
      }
    }

    return { ok: true };
  } catch (error) {
    console.error('Error validating inventory availability:', error);
    return {
      ok: false,
      code: 'inventory_check_failed',
      message: 'Could not check inventory right now. Please try again.'
    };
  }
}

export async function saveOrderToFirebase({ phone, items, totalAmount, customerName, paymentStatus = 'Pending' }) {
  try {
    const userId = await resolveStoreUserId();
    if (!userId) {
      console.error("No store userId found. Cannot save order.");
      return false;
    }
    
    const ordersRef = collection(db, `users/${userId}/orders`);
    const cleanPhone = phone.replace(/\D/g, '');
    
    const descriptions = items.map((item, i) => {
        return i === items.length - 1 ? item.description : item.description + ',';
    }).join(' ');

    const orderDoc = {
      id: `#ORD-${Math.floor(10000 + Math.random() * 90000)}`,
      name: descriptions || 'Custom Order',
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      timestamp: new Date().getTime(), // Add timestamp for easier sorting/cancellation
      customer: customerName ? `${customerName} (${cleanPhone})` : `Phone: +${cleanPhone}`,
      phone: cleanPhone, // Explicit phone field for easier lookup
      initials: customerName ? customerName.substring(0, 2).toUpperCase() : 'WA',
      status: paymentStatus === 'Paid' ? 'Paid' : 'Pending', // Show 'Paid' or 'Pending'
      amount: `${totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      sColor: paymentStatus === 'Paid' ? 'tertiary' : 'secondary',
      items: items // Save the items details
    };
    
    await addDoc(ordersRef, orderDoc);
    console.log("Order successfully saved to Firebase!");

    // 📉 Update Inventory Stock atomically
    const batch = writeBatch(db);
    for (const item of items) {
      if (!item.id) continue;
      const itemRef = doc(db, `users/${userId}/inventory/${item.id}`);
      
      // Update the stock using increment for atomicity
      // and status based on a rough estimate (using current fetched stock)
      const estNewStock = Math.max(0, (item.stock || 0) - (item.quantity || 1));
      const newStatus = estNewStock < 20 ? 'error' : 'tertiary';
      
      batch.update(itemRef, { 
        stock: increment(-(item.quantity || 1)),
        status: newStatus
      });
      console.log(`📉 Queued stock update for ${item.description}: -${item.quantity || 1}`);
    }
    await batch.commit();
    console.log("✅ Inventory batch update completed.");

    return true;
  } catch (error) {
    console.error("Error saving order to Firebase:", error);
    return false;
  }
}

/**
 * Cancel (delete) the most recent order for a specific phone number
 * @param {string} phone - The customer's phone number digits
 */
export async function cancelLastOrderFromFirebase(phone) {
  try {
    const cleanPhone = phone.replace(/\D/g, ''); 
    console.log(`🔍 Resolving merchant ID to find orders for: ${cleanPhone}`);
    
    const userId = await resolveStoreUserId();
    if (!userId) {
      console.error("❌ No store userId found. Cannot resolve merchant ID.");
      return false;
    }
    console.log(`🏢 Searching in orders for store owner: ${userId}`);
    
    // Fetch recent orders from THIS user's collection (prevents index requirements for collectionGroup)
    const ordersRef = collection(db, `users/${userId}/orders`);
    const snapshot = await getDocs(ordersRef);
    
    if (snapshot.empty) {
      console.log(`📭 No orders found for user ${userId}`);
      return false;
    }
    
    // Filter and sort in JavaScript for maximum flexibility
    const relevantOrders = snapshot.docs
      .map(doc => ({ id: doc.id, ref: doc.ref, data: doc.data() }))
      .filter(doc => {
        const data = doc.data;
        const dbPhone = String(data.phone || "").replace(/\D/g, '');
        const dbCustomer = String(data.customer || "").toLowerCase();
        
        // Exact match on phone field
        if (dbPhone === cleanPhone) return true;
        // Or if the phone number is part of the customer name/string
        if (dbCustomer.includes(cleanPhone)) return true;
        // Or if it's a partial match (last 10 digits) - common with country code variations
        if (cleanPhone.length >= 10 && dbPhone.endsWith(cleanPhone.slice(-10))) return true;
        
        return false;
      })
      .sort((a, b) => (b.data.timestamp || 0) - (a.data.timestamp || 0));
    
    if (relevantOrders.length === 0) {
      console.log(`❌ No matching orders found for ${cleanPhone} among ${snapshot.size} total orders.`);
      return false;
    }
    
    const docToDelete = relevantOrders[0];
    await deleteDoc(docToDelete.ref);
    console.log(`✅ Successfully deleted order ${docToDelete.data.id} for ${cleanPhone}`);
    return true;
  } catch (error) {
    console.error("❌ Error in cancelLastOrderFromFirebase:", error);
    return false;
  }
}

export async function saveUdharToFirebase({ phone, customerName, amount, items = [] }) {
  try {
    const userId = await resolveStoreUserId();
    if (!userId) {
      console.error("No store userId found. Cannot save udhar.");
      return false;
    }
    
    const udharRef = collection(db, `users/${userId}/udhar`);
    const udharTransactionsRef = collection(db, `users/${userId}/udharTransactions`);
    const cleanPhone = String(phone || '').replace(/\D/g, '');
    const normalizedCustomerName = String(customerName || '').trim().toLowerCase();
    const parseCurrencyValue = (value) => {
      if (typeof value === 'number') return value;
      return parseFloat(String(value ?? '').replace(/[^\d.-]/g, '')) || 0;
    };
    const description = items.length === 1
      ? items[0]?.description || 'WhatsApp order'
      : items.length > 1
        ? `${items.length} Items`
        : 'WhatsApp order';

    await addDoc(udharTransactionsRef, {
      customerId: cleanPhone || customerName,
      customerName,
      type: 'credit',
      amount,
      description,
      timestamp: Timestamp.now(),
      paymentMethod: 'udhaar',
      items: items.map((item) => ({
        id: item.id || '',
        description: item.description || '',
        price: Number(item.price || 0),
        quantity: Number(item.quantity || 1)
      }))
    });

    const udharSnapshot = await getDocs(udharRef);
    const existingDoc = udharSnapshot.docs.find((snapshotDoc) => {
      const data = snapshotDoc.data();
      const existingPhone = String(data.phone || '').replace(/\D/g, '');
      const existingName = String(data.name || '').trim().toLowerCase();

      if (cleanPhone && existingPhone && cleanPhone === existingPhone) {
        return true;
      }

      return normalizedCustomerName && existingName === normalizedCustomerName;
    });
    
    if (existingDoc) {
      const docRef = existingDoc.ref;
      const data = existingDoc.data();
      const currentAmount = parseCurrencyValue(data.amount);
      const newAmount = currentAmount + amount;
      
      await updateDoc(docRef, {
        amount: newAmount.toLocaleString('en-IN'),
        name: customerName || data.name || '',
        phone: cleanPhone || data.phone || '',
        lastUpdated: new Date().toISOString()
      });
      console.log(`Udhar updated for ${customerName}: ${currentAmount} -> ${newAmount}`);
    } else {
      const newUdhar = {
        name: customerName,
        initials: customerName.substring(0, 2).toUpperCase(),
        lastPayment: 'Never',
        amount: amount.toLocaleString('en-IN'),
        bg: 'bg-secondary-fixed',
        text: 'text-on-secondary-container',
        phone: cleanPhone,
        lastUpdated: new Date().toISOString()
      };
      await addDoc(udharRef, newUdhar);
      console.log(`Udhar created for ${customerName}: ${amount}`);
    }
    
    console.log("Udhar successfully recorded!");
    return true;
  } catch (error) {
    console.error("Error saving Udhar to Firebase:", error);
    return false;
  }
}


/**
 * Updates the bot's status (QR code, connection state) in Firebase
 * @param {Object} status - { qr, connection, isOnline }
 */
export async function updateBotStatusInFirebase(status) {
  try {
    const userId = await resolveStoreUserId();
    if (!userId) {
      console.warn("No store userId found for bot status.");
      return;
    }
    const botStatusRef = doc(db, `users/${userId}/bot/status`);
    
    await setDoc(botStatusRef, {
      ...status,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    
    console.log("Bot status updated in Firebase.");
  } catch (error) {
    console.error("Error updating bot status in Firebase:", error);
  }
}
/**
 * Fetches all store data (orders, inventory, udhar) to provide context for AI admin queries
 */
export async function fetchAdminSummaryData() {
  try {
    const [inventory, orders, udhar] = await Promise.all([
      fetchInventoryFromWebsite(),
      (async () => {
        try {
          const response = await fetch(`${WEBSITE_API_BASE_URL}/orders`, { method: 'GET' });
          if (!response.ok) throw new Error(`Orders API returned ${response.status}`);
          const data = await response.json();
          return Array.isArray(data) ? data : [];
        } catch (e) {
          console.error('Error fetching orders from Website API:', e);
          return [];
        }
      })(),
      (async () => {
        try {
          const response = await fetch(`${WEBSITE_API_BASE_URL}/udhar`, { method: 'GET' });
          if (!response.ok) throw new Error(`Udhar API returned ${response.status}`);
          const data = await response.json();
          return Array.isArray(data) ? data : [];
        } catch (e) {
          console.error('Error fetching udhar from Website API:', e);
          return [];
        }
      })(),
    ]);

    return { orders, inventory, udhar };
  } catch (error) {
    console.error('Error fetching admin summary data:', error);
    return { orders: [], inventory: [], udhar: [] };
  }
}
