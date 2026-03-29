import { getMenu } from '../menu.js';
import { setState } from '../storage.js';

export const stageOne = {
  async exec({ from, message, client, state }) {
    const text = (message || '').toLowerCase().trim();
    const menu = await getMenu();

    // Check for "show me the menu" intent
    if (text === 'show me the menu' || text.includes('menu')) {
      let msg = '🌟 *OUR CATALOG* 🌟\n';
      msg += '━━━━━━━━━━━━━━━━\n\n';
      
      const inStock = [];
      const outOfStock = [];

      Object.keys(menu).forEach((key) => {
        const item = menu[key];
        if (Number(item.stock || 0) > 0) {
          inStock.push(item);
        } else {
          outOfStock.push(item);
        }
      });

      if (inStock.length > 0) {
        msg += '🛒 *IN STOCK*\n';
        inStock.forEach((item) => {
          msg += `📦 *${item.description}*\n`;
          msg += `💰 Price: ₹${item.price}\n`;
          msg += `🔢 Quantity: ${item.stock} left\n\n`;
        });
      }

      if (outOfStock.length > 0) {
        msg += '━━━━━━━━━━━━━━━━\n';
        msg += '🚫 *OUT OF STOCK*\n';
        outOfStock.forEach((item) => {
          msg += `📦 ~${item.description}~\n`;
          msg += `💰 Price: ₹${item.price}\n\n`;
        });
      }
      
      msg += '━━━━━━━━━━━━━━━━\n';
      msg += 'Type the *item name* to start your order! 🚀';
      return msg;
    }

    // Check for greeting intents
    const greetings = ['hi', 'hello', 'hey', 'namaste', 'halo', 'greetings', 'sup', 'yo'];
    if (greetings.includes(text)) {
      return `👋 *Hello!* Welcome to *KiranaBot* — your smart shopping assistant.

🛒 How can I help you today?
- Ask to *"show the menu"* 📋
- Or simply type what you need! (e.g., *"Milk"*) ✍️`;
    }

    // Strip common intent prefixes
    const prefixes = ['i want this', 'i want', 'i need', 'give me', 'can i get', 'order', 'give'];
    let query = text;
    for (const prefix of prefixes) {
      if (query.startsWith(prefix)) {
        query = query.replace(prefix, '').trim();
        break;
      }
    }
    
    // Extract quantity from the original text (before prefix stripping)
    const wordToNum = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10,
      eleven:11, twelve:12, fifteen:15, twenty:20, thirty:30, forty:40, fifty:50, hundred:100 };
    let parsedQty = 1;
    const numMatch = text.match(/\b(\d+)\b/);
    if (numMatch) {
      parsedQty = parseInt(numMatch[1], 10);
    } else {
      for (const [word, num] of Object.entries(wordToNum)) {
        if (text.includes(word)) { parsedQty = num; break; }
      }
    }

    // Only attempt fuzzy search if the query is decent length
    if (query.length > 1) {
      // Do a fuzzy search on the menu
      let matchedItem = null;

      for (const [key, item] of Object.entries(menu)) {
        const desc = item.description.toLowerCase();
        
        // Match if user's word is in the item name, or item name is in user's query
        if (desc.includes(query) || query.includes(desc)) {
          matchedItem = item;
          break; // take the first match
        }
      }

      if (matchedItem) {
        // Staging for confirmation
        state.pendingItem = matchedItem;
        state.pendingQuantity = parsedQty;
        state.stage = 2; 
        setState(from, state);
        
        const totalValue = matchedItem.price * parsedQty;
        const qtyDisplay = parsedQty > 1 ? `${parsedQty}x ` : '';

        return `🛒 *CONFIRM ORDER* 🛒
━━━━━━━━━━━━━━━━

📦 *Item:* ${qtyDisplay}${matchedItem.description}
💰 *Total Price:* ₹${totalValue}

👉 Reply with *YES* to confirm or *NO* to cancel.`;
      } else {
        return `Hmm, I couldn't find *"${query}"* in our current menu. 🛍️\n\nTry checking the *menu* or ask an attendant if you're looking for something specific!`;
      }
    }

    return 'Welcome! You can say *"show me the menu"* or type the name of an item you want to order. 🛒';
  },
};
