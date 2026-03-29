# Admin WhatsApp Feature

## Overview
When you (the business owner) send messages from your own WhatsApp number to the bot, it will respond with business information and analytics instead of treating you as a customer.

## Setup

### 1. Configure Admin Phone Number
Add your phone number to the `.env` file:

```env
# Your business phone number (digits only, with country code)
# Example: 919876543210
ADMIN_PHONE_NUMBER=919876543210
```

### 2. How It Works

- **Customer Messages**: When other customers message the bot, they get the normal ordering experience
- **Admin Messages**: When YOU message the bot from your configured number, you get business analytics

### 3. What You Can Ask

As an admin, you can ask the bot questions like:

- "How many orders are pending?"
- "Who has udhaar?"
- "What's my inventory status?"
- "Show me today's orders"
- "How much stock of [item] do I have?"
- "List all pending payments"
- "What's my total revenue?"

### 4. Example Conversation

**You (Admin):** "How many orders are pending?"

**Bot Response:**
```
🔑 ADMIN RESPONSE
━━━━━━━━━━━━━━━━

You have 3 pending orders:

1. Order #ORD-80228 - Phone: +918437867986, Amount: ₹75.00
2. Order #ORD-84916 - Sahil (918437867986), Amount: ₹60.00
3. Order #ORD-16644 - Sahil (918437867986), Amount: ₹20.00

Total pending amount: ₹155.00
```

**You (Admin):** "Who has udhaar?"

**Bot Response:**
```
🔑 ADMIN RESPONSE
━━━━━━━━━━━━━━━━

Current credit balances:

1. Anil Kirana Store - ₹24,500 (Last updated: 2 days ago)
2. Rajesh Mart - ₹1,12,000 (Last updated: Today)
3. Saraswati General - ₹8,740 (Last updated: 15 days ago)
4. Pooja Varieties - ₹15,200 (Last updated: Never)

Total outstanding: ₹1,60,440
```

## Important Notes

1. **Security**: Only the phone number configured in `ADMIN_PHONE_NUMBER` will get admin responses
2. **AI-Powered**: The bot uses AI to understand your questions naturally
3. **Real-Time Data**: All responses are based on current data from your Firebase database
4. **No Interference**: Admin mode doesn't affect customer experience at all

## Troubleshooting

### Bot doesn't recognize me as admin
- Check that `ADMIN_PHONE_NUMBER` in `.env` matches your WhatsApp number exactly
- Format should be digits only with country code (e.g., `919876543210`)
- Restart the bot after changing `.env` file

### Bot gives generic responses
- Make sure `GROQ_API_KEY` is configured in `.env`
- Check that the bot has internet connection to access the AI service

### No data in responses
- Verify that your Firebase database has orders/inventory/udhar data
- Check the bot logs for any Firebase connection errors
