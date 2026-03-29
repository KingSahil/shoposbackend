# Admin Feature Testing Guide

## Prerequisites

1. Bot is running and connected to WhatsApp
2. `ADMIN_PHONE_NUMBER` is set in `.env`
3. `GROQ_API_KEY` is configured (for AI responses)
4. Firebase has some test data (orders, inventory, udhar)

## Test Scenarios

### Test 1: Basic Admin Detection

**Setup:**
- Set `ADMIN_PHONE_NUMBER=919876543210` (your number)
- Restart bot

**Test:**
1. Send message from your admin number: "Hello"
2. Expected: Bot recognizes you as admin and provides admin greeting

**Success Criteria:**
- Response starts with "🔑 ADMIN RESPONSE" or "🔑 ADMIN MODE"
- No customer ordering flow initiated

---

### Test 2: Orders Query

**Test:**
1. Send: "How many orders are pending?"

**Expected Response:**
```
🔑 ADMIN RESPONSE
━━━━━━━━━━━━━━━━

You have X pending orders:
- Order #ORD-XXXXX...
```

**Success Criteria:**
- Lists actual pending orders from Firebase
- Shows order details (ID, customer, amount)

---

### Test 3: Inventory Query

**Test:**
1. Send: "What's my inventory status?"
2. Send: "How much stock of sugar do I have?"

**Expected Response:**
- Lists inventory items with stock levels
- Or specific item stock if asked

**Success Criteria:**
- Shows real inventory data
- Accurate stock numbers

---

### Test 4: Udhaar Query

**Test:**
1. Send: "Who has udhaar?"
2. Send: "Show me credit balances"

**Expected Response:**
```
🔑 ADMIN RESPONSE
━━━━━━━━━━━━━━━━

Current credit balances:
1. Customer Name - ₹XX,XXX
2. ...
```

**Success Criteria:**
- Lists all customers with outstanding credit
- Shows amounts and last update dates

---

### Test 5: Customer Still Works

**Setup:**
- Have a different phone number (not admin)

**Test:**
1. Send message from customer number: "I want sugar"

**Expected Response:**
- Normal customer ordering flow
- No admin mode activated

**Success Criteria:**
- Customer gets order draft
- No admin responses shown

---

### Test 6: Admin Can't Order

**Test:**
1. From admin number, send: "I want sugar"

**Expected Response:**
- Admin mode response (not order flow)
- Bot treats it as an admin query

**Success Criteria:**
- No order created
- Admin mode remains active

---

### Test 7: Error Handling

**Test:**
1. Temporarily break Firebase connection
2. Send admin query

**Expected Response:**
```
⚠️ Error processing admin query.

Please try again or check the logs.
```

**Success Criteria:**
- Graceful error message
- No crash
- Logs show error details

---

### Test 8: No GROQ_API_KEY

**Setup:**
- Remove or comment out `GROQ_API_KEY` in `.env`
- Restart bot

**Test:**
1. Send admin query

**Expected Response:**
- Fallback message with instructions
- Or no admin mode (falls back to customer flow)

**Success Criteria:**
- Bot doesn't crash
- Clear indication that AI is disabled

---

## Debugging Tips

### Check Logs

Look for these log messages:

```
🔑 Admin query detected from 919876543210@s.whatsapp.net
📊 [ADMIN] Fetched X orders, Y items, Z credit records
```

### Verify Phone Number Format

Admin number should be:
- ✅ `919876543210` (digits only, with country code)
- ❌ `+91 9876543210` (no spaces or symbols)
- ❌ `9876543210` (missing country code)

### Check Firebase Data

Ensure you have test data:
```javascript
// Check in Firebase Console:
users/{uid}/orders - Should have some orders
users/{uid}/inventory - Should have items
users/{uid}/udhar - Should have credit records
```

### Test AI Response

If admin mode works but responses are generic:
1. Check `GROQ_API_KEY` is valid
2. Check internet connection
3. Look for API errors in logs

---

## Common Issues

### "Bot doesn't recognize me as admin"
- Verify `ADMIN_PHONE_NUMBER` matches exactly
- Check format (digits only, with country code)
- Restart bot after changing `.env`

### "Admin gets customer flow"
- Check `isAdmin` is being set correctly
- Look for log: "🔑 Admin query detected"
- Verify NLP processor is enabled

### "Empty or generic responses"
- Check Firebase has data
- Verify `GROQ_API_KEY` is configured
- Check logs for API errors

### "Bot crashes on admin query"
- Check Firebase connection
- Verify all imports are correct
- Look for stack trace in logs
