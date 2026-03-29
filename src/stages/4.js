import { setState } from '../storage.js';
import { saveOrderToFirebase, saveUdharToFirebase } from '../firebase_client.js';
import { extractPhoneFromJid } from '../utils.js';

export const stageFour = {
  async exec({ from, message, state }) {
    const text = (message || '').toLowerCase().trim();
    const phone = extractPhoneFromJid(from);
    const item = state.pendingItem;
    const quantity = state.pendingQuantity || 1;
    const customerName = state.customerName;

    if (!item) {
      state.stage = 1;
      setState(from, state);
      return 'Something went wrong. Let\'s start over. What would you like to order?';
    }

    const totalAmount = (item.price || 0) * quantity;
    let paymentStatus = 'Pending';
    let isUdhar = false;

    if (text === 'yes' || text.includes('pay now')) {
      paymentStatus = 'Paid';
    } else if (text === 'udhaar' || text === 'udhar' || text.includes('credit')) {
      paymentStatus = 'Pending';
      isUdhar = true;
    } else {
      return 'Please choose a payment method:\n👉 Reply *YES* to pay now\n👉 Reply *UDHAAR* to add to your credit balance';
    }

    // 🚀 Prepare order items
    const items = [{
      id: item.id,
      description: item.description,
      price: item.price !== undefined ? item.price : 0,
      quantity: quantity
    }];

    // 💾 Save Order
    const orderSuccess = await saveOrderToFirebase({
      phone,
      items,
      totalAmount,
      customerName,
      paymentStatus
    });

    // 📝 Save to Udhaar if applicable
    if (orderSuccess && isUdhar) {
      await saveUdharToFirebase({
        phone,
        customerName,
        amount: totalAmount,
        items
      });
    }

    // 🔄 Reset state to Menu stage
    state.stage = 1;
    state.pendingItem = null;
    state.pendingQuantity = null;
    setState(from, state);

    if (orderSuccess) {
      if (isUdhar) {
        return `✅ Order confirmed, ${customerName}! ₹${totalAmount.toLocaleString('en-IN')} has been added to your *Udhaar* balance. You can pay later at the store.`;
      } else {
        return `✅ Order confirmed and *PAID*! Thank you, ${customerName}. We'll notify you when it's ready for pickup.`;
      }
    } else {
      return `❌ There was an error finalizing your order. Please try again or visit the store.`;
    }
  },
};
