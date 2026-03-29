import { parseNaturalLanguageOrder, parseAdminQuery, isLLMConfigured } from './groq.js';
import { shouldAttemptNLParsing } from './parser.js';
import { getMenu } from '../menu.js';
import { setState } from '../storage.js';
import { saveOrderToFirebase, cancelLastOrderFromFirebase, fetchAdminSummaryData } from '../firebase_client.js';
import { extractPhoneFromJid } from '../utils.js';

/**
 * Natural Language Order Processor
 * Intercepts messages before the stage router to detect and process NL orders
 */
export class NLOrderProcessor {
  constructor() {
    this.enabled = isLLMConfigured();
    
    if (this.enabled) {
      console.log('🤖 AI Natural Language Ordering is ENABLED');
    } else {
      console.log('⚠️  AI Natural Language Ordering is DISABLED (no GROQ_API_KEY)');
    }
  }

  /**
   * Process a message and check if it's a natural language order
   * @param {object} params - Message parameters
   * @returns {Promise<object|null>} Response object or null to continue to stage router
   */
  async process({ from, message, client, state, isAdmin }) {
    const phone = extractPhoneFromJid(from);

    // Skip if NL processing is disabled
    if (!this.enabled) {
      return null;
    }

    // --- 🔑 ADMIN FLOW ---
    if (isAdmin) {
      console.log(`🔑 Admin query detected from ${from}`);
      
      try {
        // Fetch admin data from Firebase
        const adminData = await fetchAdminSummaryData();
        
        // Call LLM to process admin query
        const adminResponse = await parseAdminQuery(message, adminData);
        
        if (adminResponse) {
          return {
            handled: true,
            response: `🔑 *ADMIN RESPONSE*\n━━━━━━━━━━━━━━━━\n\n${adminResponse}`
          };
        }
        
        // If LLM fails, provide a fallback
        return {
          handled: true,
          response: `🔑 *ADMIN MODE*\n━━━━━━━━━━━━━━━━\n\nI'm your business assistant. Ask me about:\n\n📦 Inventory levels\n💰 Pending orders\n📊 Credit (Udhaar) balances\n📈 Sales summaries\n\nExample: "How many orders are pending?" or "Who has udhaar?"`
        };
      } catch (error) {
        console.error('Admin query processing error:', error);
        return {
          handled: true,
          response: `⚠️ *Error processing admin query.*\n\nPlease try again or check the logs.`
        };
      }
    }

    // --- 🛒 CUSTOMER FLOW ---

    // Skip if user is in certain stages where NL doesn't make sense
    // Stage 5 = talking to attendant
    if (state.stage >= 5) {
      return null;
    }

    // 🔥 PRE-FILTER: Only attempt NL parsing if the message looks like an order
    // This prevents "yes", "no", etc. from being intercepted by AI
    // HOWEVER: "cancel my order" and admin queries need to be caught!
    if (!isAdmin && !shouldAttemptNLParsing(message) && !message.toLowerCase().includes('cancel')) {
      return null;
    }

    console.log(`🔍 Attempting NL processing for: "${message}" (isAdmin: ${isAdmin || false})`);
    
    // DEBUG: Log the type and value of isAdmin
    console.log(`   [DEBUG] isAdmin type: ${typeof isAdmin}, value: ${isAdmin}`);

    try {
      const history = state.history || [];
      const menu = await getMenu();

      // Helper to update history and state
      const finishWithHistory = (botResponse) => {
        const newHistory = [...history, 
          { role: 'user', content: message },
          { role: 'assistant', content: botResponse }
        ].slice(-10); // Keep last 10 messages
        
        state.history = newHistory;
        setState(from, state);
        
        return {
          handled: true,
          response: botResponse
        };
      };

      // --- 🛒 CUSTOMER FLOW ---
      
      // 🔥 PRE-FILTER: Only attempt NL parsing if the message looks like an order
      // This prevents "yes", "no", etc. from being intercepted by AI
      // HOWEVER: "cancel my order" needs to be caught!
      if (!shouldAttemptNLParsing(message) && !message.toLowerCase().includes('cancel')) {
        return null;
      }

      // Call LLM provider to parse the message
      const parsedOrder = await parseNaturalLanguageOrder(message, menu, history);

      if (!parsedOrder) {
        return null;
      }

      console.log('✅ Intent detected:', parsedOrder.intent);

      // --- HANDLE GREETING INTENT ---
      if (parsedOrder.intent === 'greeting') {
        return finishWithHistory(parsedOrder.response || `👋 *Hello!* Welcome to *KiranaBot* — your smart shopping assistant.
          
🛒 How can I help you today?
- Ask to *"show the menu"* 📋
- Or simply type what you need! (e.g., *"1kg sugar"*) ✍️`);
      }

      // --- HANDLE SHOW MENU INTENT ---
      if (parsedOrder.intent === 'show_menu') {
        let msg = parsedOrder.response ? `${parsedOrder.response}\n\n` : '';
        msg += '🌟 *OUR CATALOG* 🌟\n';
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
        return finishWithHistory(msg);
      }
      if (parsedOrder.intent === 'confirm_order') {
        // Only handle if there's actually a pending item — otherwise let Stage 2 handle it
        if (state.pendingItem) {
          if (!state.customerName) {
            state.stage = 3; 
            return finishWithHistory('✅ *Draft Confirmed.*\n\nPlease provide your *name* to finalize:');
          } else {
            state.stage = 4;
            return finishWithHistory(`✅ *Draft Confirmed.*\n\n💳 *PAYMENT METHOD*\n━━━━━━━━━━━━━━━━\n\nHow would you like to pay?\n\n👉 *YES* - Pay now\n👉 *UDHAAR* - Add to credit`);
          }
        }
        // No pending item — fall through to stages (Stage 2 handles YES/NO)
        return null;
      }

      // --- HANDLE CANCEL ORDER INTENT ---
      if (parsedOrder.intent === 'cancel_order') {
        if (state.pendingItem) {
          state.stage = 0;
          state.itens = [];
          delete state.pendingItem;
          delete state.pendingQuantity;
          return finishWithHistory("🗑️ *Draft cleared.*");
        }

        const cancelled = await cancelLastOrderFromFirebase(phone);
        state.stage = 0;
        state.itens = [];
        delete state.pendingItem;
        delete state.pendingQuantity;

        if (cancelled) {
          return finishWithHistory(`✅ *Order Cancelled.*`);
        } else {
          return finishWithHistory(`📋 *No recent order found to cancel.*`);
        }
      }

      // --- HANDLE OTHER INTENT ---
      // Return null to let Stage Router (fuzzy match in Stage 1) handle it
      if (parsedOrder.intent === 'other' || parsedOrder.intent === 'unknown') {
        return null;
      }

      // --- HANDLE NEW ORDER INTENT ---
      if (parsedOrder.items.length === 0) {
        return finishWithHistory("⚠️ *Item match failed.*\n\nPlease check the menu for correct naming.");
      }

      const itemToConfirm = parsedOrder.items[0];
      const quantity = itemToConfirm.quantity || 1;
      
      let menuMatchedItem = null;
      for (const [key, mItem] of Object.entries(menu)) {
        if (key === String(itemToConfirm.id)) {
          menuMatchedItem = mItem;
          break;
        }
      }

      if (!menuMatchedItem) {
        // AI returned a bad ID — fall through to Stage 1 fuzzy match
        return null;
      }

      state.pendingItem = menuMatchedItem;
      state.pendingQuantity = quantity;
      state.stage = 2; 
      
      const totalValue = (menuMatchedItem.price || 0) * quantity;
      const quantityStr = quantity > 1 ? `${quantity}x ` : '';

      return finishWithHistory(`📝 *ORDER DRAFT*
━━━━━━━━━━━━━━━━

📦 *Item:* ${quantityStr}${menuMatchedItem.description}
💰 *Total:* ₹${totalValue}

👉 Reply *YES* to confirm or *NO* to cancel.`);
    } catch (error) {
      console.error('NL Processing error:', error);
      return null; // Fall back to stage router on error
    }
  }

  /**
   * Check if the processor is enabled
   */
  isEnabled() {
    return this.enabled;
  }
}

// Singleton instance
let processorInstance = null;

/**
 * Get the NL Order Processor instance
 * @returns {NLOrderProcessor}
 */
export function getNLProcessor() {
  if (!processorInstance) {
    processorInstance = new NLOrderProcessor();
  }
  return processorInstance;
}

/**
 * Process a message through NL pipeline
 * Convenience function for server.js
 */
export async function processNaturalLanguage(params) {
  const processor = getNLProcessor();
  return processor.process(params);
}
