import Groq from 'groq-sdk';

function getGroqConfig() {
  const apiKey = process.env.GROQ_API_KEY;

  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  };
}

function getGroqClient() {
  const config = getGroqConfig();

  if (!config) {
    return null;
  }

  return new Groq({ apiKey: config.apiKey });
}

/**
 * Extract order intent from natural language using Groq tool calling
 * @param {string} userMessage - The user's natural language message
 * @param {object} menuItems - Available menu items
 * @param {Array} history - Conversation history [{role: 'user'|'assistant', content: ''}]
 * @returns {Promise<object|null>} Parsed order or null if not an order
 */
export async function parseNaturalLanguageOrder(userMessage, menuItems, history = []) {
  const config = getGroqConfig();
  const client = getGroqClient();

  if (!config || !client) {
    return null;
  }

  const menuDescription = Object.entries(menuItems)
      .map(([id, item]) => `ID ${id}: ${item.description} - ${item.price} rupees`)
    .join('\n');

  const tools = [
    {
      type: 'function',
      function: {
        name: 'create_order',
        description: 'Create an order from the customer request. Use this when the customer wants to order items from the menu.',
        parameters: {
          type: 'object',
          properties: {
            items: {
              type: 'array',
              description: 'List of items the customer wants to order',
              items: {
                type: 'object',
                properties: {
                  id: {
                    type: 'string',
                    description: 'The menu item ID',
                  },
                  quantity: {
                    type: 'number',
                    description: 'How many of this item (default 1)',
                  },
                  modifications: {
                    type: 'string',
                    description: 'Any modifications like "no mayo", "extra cheese", etc.',
                  },
                },
                required: ['id', 'quantity'],
              },
            },
            address: {
              type: 'string',
              description: 'Delivery address if provided by the customer',
            },
          },
          required: ['items'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'confirm_last_order',
        description: 'Use this when the user confirms the order they were just discussing (e.g., saying "Yes", "Kardo", "Confirm").',
        parameters: {
          type: 'object',
          properties: {
            confirmation: {
              type: 'boolean',
              description: 'Whether the user confirmed (true) or rejected (false) the order.',
            }
          },
          required: ['confirmation'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'not_an_order',
        description: 'Use this when the message is NOT an order request (greetings, questions, complaints, cancellations, etc.)',
        parameters: {
          type: 'object',
          properties: {
            reason: {
              type: 'string',
              description: 'Why this is not an order (e.g. greeting, question about menu, cancellation request)',
            },
            intent: {
              type: 'string',
              description: 'The classified intent: "greeting", "show_menu", "cancel_order", or "other"',
            },
            response: {
              type: 'string',
              description: 'A natural, conversational response to the user message in English or Hinglish (Hindi + English). Be helpful and friendly. If they ask for something not on the menu, explain it politely.',
            }
          },
          required: ['reason', 'intent', 'response'],
        },
      },
    },
  ];

  const systemPrompt = `You are "KiranaBot", a professional automated inventory and ordering assistant for a Kirana store.

AVAILABLE MENU:
${menuDescription}

YOUR TASK:
1. Use 'create_order' if the user specifies ANY items from the menu or expresses intent to buy.
   - Match item names to IDs using the PROVIDED MENU ONLY.
   - "atta maggi" MUST match the ID for "atta maggi" in the menu.
   - Include quantity if mentioned (default 1).
2. Use 'confirm_last_order' (true/false) if the user is confirming or rejecting a previously mentioned order draft (e.g., "Kardo", "Confirm", "Yes", "No", "Nahi").
3. Use 'not_an_order' for non-transactional messages:
   - intent "greeting": For "Hi", "Hello".
   - intent "show_menu": ONLY if they explicitly ask for the menu/list without naming a specific item to buy.
   - intent "cancel_order": If they want to cancel an existing record.
   - intent "other": For everything else.

GUIDELINES:
- CRITICAL: If the user says "I want [item]", "Send [item]", or "[item] kardo", treat it as 'create_order'.
- DO NOT use 'show_menu' if a specific item name is mentioned in the message.
- Be concise and professional. Use "Hinglish" sparingly and only for politeness (e.g., "Ji", "Theek hai").
- DO NOT repeat back the order in a chatty way if you are calling a tool.

EXAMPLES:
- "I want atta maggi" -> create_order (ID for atta maggi, qty 1)
- "8 atta maggi packets" -> create_order (ID for atta maggi, qty 8)
- "Kardo" -> confirm_last_order(confirmation=true)
- "Show menu" -> not_an_order(intent="show_menu", response="Certainly. Here is our current catalog:")`;

  try {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userMessage },
    ];

    const response = await client.chat.completions.create({
      model: config.model,
      messages,
      tools,
      tool_choice: 'auto',
      temperature: 0.1,
    });

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];

    if (!toolCall) {
      // If no tool call, treat it as a normal message/other intent
      return {
        intent: 'other',
        response: response.choices[0]?.message?.content || null,
      };
    }

    const functionName = toolCall.function.name;
    const args = JSON.parse(toolCall.function.arguments);

    if (functionName === 'create_order' && args.items?.length > 0) {
      return {
        intent: 'new_order',
        items: args.items,
        address: args.address || null,
      };
    } else if (functionName === 'confirm_last_order') {
      return {
        intent: args.confirmation ? 'confirm_order' : 'cancel_order',
        response: args.confirmation ? 'Theek hai, order confirm kar raha hoon.' : 'Theek hai, order cancel kar diya.',
      };
    } else if (functionName === 'not_an_order') {
      return {
        intent: args.intent || 'other',
        response: args.response || null,
      };
    }

    return null;
  } catch (error) {
    console.error('GROQ API error:', error);
    return null;
  }
}

/**
 * Handle administrative queries from the shopkeeper about store data
 * @param {string} userMessage - The admin's query
 * @param {object} storeData - { orders, inventory, udhar }
 * @returns {Promise<string|null>} Response to the admin
 */
export async function parseAdminQuery(userMessage, storeData) {
  const config = getGroqConfig();
  const client = getGroqClient();

  if (!config || !client) {
    return null;
  }

  // Format data for context
  const ordersSummary = storeData.orders.map(o => 
    `- Order ${o.id}: ${o.customer}, Amount: ₹${o.amount}, Status: ${o.status}, Date: ${o.date}, Phone: ${o.phone}`
  ).join('\n');

  const inventorySummary = storeData.inventory.map(i => 
    `- ${i.name} (SKU: ${i.sku}): Price ₹${i.unitPrice}, Stock: ${i.stock}`
  ).join('\n');

  const udharSummary = storeData.udhar.map(u => 
    `- Customer: ${u.name}, Balance: ₹${u.amount}, Last Updated: ${u.lastUpdated}`
  ).join('\n');

  const systemPrompt = `You are the AI "Admin Assistant" for the KiranaKeeper platform. Your job is to help the shopkeeper manage their business by answering questions about their data.

STORE DATA CONTEXT:

--- ORDERS ---
${ordersSummary || 'No orders yet.'}

--- INVENTORY ---
${inventorySummary || 'No items in inventory.'}

--- UDHAAR (CREDIT) ---
${udharSummary || 'No credit records.'}

--- END OF DATA ---

YOUR TASK:
- Answer the shopkeeper's question accurately based on the provided data.
- Use a professional yet friendly "shopkeeper" tone.
- Be concise but helpful.
- If they ask for a list (like "who has udhaar"), provide a clear, bulleted list.
- If they ask for totals (like "how many orders are pending"), calculate it correctly.
- If you don't find the answer in the data, say so politely.
- Use Hinglish (Hindi + English) where appropriate as the shopkeeper is likely Indian.

EXAMPLES:
- "Kitne orders pending hain?" -> Count orders with status "Pending" and list them.
- "Who has udhaar?" -> List all customers in the Udhaar section with their balances.
- "How much stock of Apple do I have?" -> Check inventory for "Apple" and report the stock.
- "Show me my menu" -> Provide a list of items and their prices.`;

  try {
    const response = await client.chat.completions.create({
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1,
    });

    return response.choices[0]?.message?.content || "Sorry, I couldn't process that query.";
  } catch (error) {
    console.error('GROQ Admin API error:', error);
    return null;
  }
}

/**
 * Check if Groq is configured and available
 */
export function isLLMConfigured() {
  return !!getGroqConfig();
}
