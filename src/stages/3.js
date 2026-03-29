import { setState } from '../storage.js';
import { saveOrderToFirebase } from '../firebase_client.js';
import { extractPhoneFromJid } from '../utils.js';

export const stageThree = {
  async exec({ from, message, state }) {
    const customerName = (message || '').trim();
    
    if (!customerName || customerName.length < 2) {
      return 'Please provide a valid name so we can identify your order.';
    }

    // 💾 Persist customer name in state
    state.customerName = customerName;

    // 🚀 Instead of finalizing, ask for payment method
    state.stage = 4;
    setState(from, state);

    return `Nice to meet you, ${state.customerName}! 🤝

Do you want to pay for your order now? 

👉 Reply with *YES* to pay now
👉 Reply with *UDHAAR* to add to your credit balance`;
  },
};
