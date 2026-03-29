# Quick Admin Setup Guide

## Step 1: Add Your Phone Number to .env

Open your `.env` file and add:

```env
ADMIN_PHONE_NUMBER=919876543210
```

Replace `919876543210` with your actual WhatsApp number (digits only, including country code).

**Important:** This should be the SAME number that the bot is connected to. You'll be typing messages to yourself (self-chat).

## Step 2: Restart the Bot

```bash
npm start
```

Or if using nodemon:

```bash
npm run dev
```

You should see in the logs:
```
🔑 Admin whitelist active for: 919876543210
```

## Step 3: Test It!

Open WhatsApp and find your own chat (the bot's number). Type a message to yourself:

**You:** "How many orders are pending?"

**Bot:** 
```
🔑 ADMIN RESPONSE
━━━━━━━━━━━━━━━━

You have 3 pending orders:
- Order #ORD-80228...
```

## Important Notes

1. **Self-Chat**: You're messaging yourself (the bot's number). This is normal!
2. **No Loops**: The bot is smart enough to only respond to YOUR messages, not its own replies
3. **Admin Only**: Only messages from `ADMIN_PHONE_NUMBER` get admin responses
4. **Customer Mode**: If you want to test customer ordering, use a different phone number

## That's It!

Now when you message yourself:
- ✅ You get business analytics and reports
- ✅ Other customers still get the normal ordering experience
- ✅ No message loops or repetition

## Example Admin Queries

Try asking:
- "Show me today's orders"
- "Who has udhaar?"
- "What's my inventory status?"
- "How much stock of sugar do I have?"
- "List all pending payments"
- "What's my total revenue?"

The bot uses AI to understand your questions naturally!
