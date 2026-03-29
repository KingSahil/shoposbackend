import { setState } from '../storage.js';
import { extractPhoneFromJid } from '../utils.js';

const YES_WORDS = ['yes', 'yes i want this', 'kardo', 'haan', 'ha', 'ji', 'confirm', 'theek', 'ok', 'okay', 'sure', 'bilkul', 'done'];
const NO_WORDS = ['no', 'nahi', 'na', 'nope', 'cancel', 'mat', 'rehne', 'rehne do', 'band karo'];

export const stageTwo = {
  async exec({ from, message, state }) {
    const text = (message || '').toLowerCase().trim();

    const isYes = YES_WORDS.some(w => text === w || text.startsWith(w + ' '));
    const isNo = NO_WORDS.some(w => text === w || text.startsWith(w + ' '));

    if (isYes) {
      const item = state.pendingItem;
      const quantity = state.pendingQuantity || 1;

      if (!item) {
        state.stage = 1;
        setState(from, state);
        return 'Something went wrong, please try ordering again.';
      }

      // 👤 Check if we already know the customer's name
      if (!state.customerName) {
        state.stage = 3; // Move to Ask Name stage
        setState(from, state);
        return 'Okay! Before I finish your order, what is your name?';
      }

      // Name is known, ask for payment method
      state.stage = 4;
      setState(from, state);

      return `💳 *PAYMENT METHOD* 💳
━━━━━━━━━━━━━━━━

Do you want to pay for your order now? 

👉 Reply with *YES* to pay now
👉 Reply with *UDHAAR* to add to your credit balance`;

    } else if (isNo) {
      state.stage = 1;
      state.pendingItem = null;
      state.pendingQuantity = null;
      setState(from, state);
      return `No problem. Let me know if you want to place another order! (say *"show me the menu"*)`;
    }

    // Prompt again with correct quantity shown
    const item = state.pendingItem;
    const quantity = state.pendingQuantity || 1;
    if (item) {
      const total = item.price * quantity;
      const qtyStr = quantity > 1 ? `${quantity}x ` : '';
      return `Please reply with *YES* or *NO* to confirm your order:\n\n📦 ${qtyStr}${item.description} — ₹${total}`;
    }

    return 'Please reply with *YES* or *NO* to confirm your order.';
  },
};
