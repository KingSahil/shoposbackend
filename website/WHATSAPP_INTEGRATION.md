# WhatsApp Order Delivery Notification Integration

## Overview
When an order is marked as "Delivered" in the Orders view, the system automatically queues a WhatsApp message to notify the customer.

## How It Works

### 1. Frontend Integration (OrdersView.tsx)
When you click "Mark Delivered" on an order:
- The order status is updated to "Delivered" in Firestore
- If the customer has a valid phone number, a WhatsApp message is queued
- The message is stored in `users/{uid}/whatsapp_messages` collection

### 2. Message Format
The WhatsApp message sent to customers includes:
```
✅ *Order Delivered Successfully!*

Hi {Customer Name},

Your order {Order ID} has been delivered.

📦 *Order Details:*
• Items: {Item Names}
• Amount: ₹{Amount}
• Date: {Date}

Thank you for your business! 🙏
```

### 3. Data Structure

#### WhatsApp Message Document
```javascript
{
  to: "+919876543210",           // Customer phone number
  message: "...",                 // Formatted message text
  orderId: "#ORD-12345",         // Reference to order
  status: "pending",              // pending | sent | failed
  createdAt: "2026-03-29T...",   // ISO timestamp
  type: "order_delivered"         // Message type
}
```

## Backend Setup Required

To actually send WhatsApp messages, you need to set up a backend service that:

### Option 1: Using WhatsApp Business API (Official)
1. Sign up for WhatsApp Business API
2. Get API credentials
3. Create a Cloud Function or backend service to listen to `whatsapp_messages` collection
4. Send messages via WhatsApp Business API
5. Update message status to "sent" or "failed"

### Option 2: Using WhatsApp Web (via kiranabot)
Based on your existing bot integration in DashboardView, you already have a bot setup:

1. **Bot Status Collection**: `users/{uid}/bot/status`
   - Contains: `isOnline`, `qr`, `connection`

2. **Create Message Listener**:
   Your bot should listen to `users/{uid}/whatsapp_messages` where `status == 'pending'`

3. **Send Messages**:
   When a new message is detected, send it via WhatsApp Web
   
4. **Update Status**:
   After sending, update the document:
   ```javascript
   {
     status: "sent",
     sentAt: new Date().toISOString()
   }
   ```

## Firebase Cloud Function Example

```javascript
import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();

export const sendWhatsAppMessage = functions.firestore
  .document('users/{userId}/whatsapp_messages/{messageId}')
  .onCreate(async (snap, context) => {
    const message = snap.data();
    const { userId } = context.params;
    
    // Check if bot is online
    const botStatus = await admin.firestore()
      .doc(`users/${userId}/bot/status`)
      .get();
    
    if (!botStatus.exists || !botStatus.data()?.isOnline) {
      await snap.ref.update({
        status: 'failed',
        error: 'Bot is not online'
      });
      return;
    }
    
    try {
      // Send message via your WhatsApp bot API
      // This depends on your bot implementation
      await sendMessageViaBot(message.to, message.message);
      
      await snap.ref.update({
        status: 'sent',
        sentAt: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (error) {
      await snap.ref.update({
        status: 'failed',
        error: error.message
      });
    }
  });
```

## Firestore Security Rules

Add these rules to allow the app to create WhatsApp messages:

```javascript
match /users/{userId}/whatsapp_messages/{messageId} {
  allow create: if request.auth.uid == userId;
  allow read, update: if request.auth.uid == userId;
}
```

## Testing

1. **Create a test order** with a valid phone number
2. **Mark it as delivered** from the Orders view
3. **Check Firestore** for the new document in `whatsapp_messages` collection
4. **Verify the message** contains correct order details
5. **Check bot status** to ensure it's online
6. **Monitor message status** changes from "pending" to "sent"

## Phone Number Format

The system expects phone numbers in international format:
- ✅ Good: `+919876543210`, `919876543210`
- ❌ Bad: `9876543210`, `98765-43210`

## Customization

You can customize the message template in `OrdersView.tsx`:

```javascript
const message = `✅ *Order Delivered Successfully!*\n\n...`;
```

## Error Handling

The system handles these scenarios:
- ✅ No phone number: Order marked delivered, no WhatsApp attempt
- ✅ Invalid phone: Order marked delivered, WhatsApp fails gracefully
- ✅ Bot offline: Message queued, will be sent when bot comes online
- ✅ Network error: Message status set to "failed" for retry

## Next Steps

1. Deploy the updated code to Firebase Hosting
2. Set up Firebase Cloud Functions for message processing
3. Configure your WhatsApp bot to listen to the messages collection
4. Test with real phone numbers
5. Monitor message delivery rates in Firestore

## Related Files

- `website/src/views/OrdersView.tsx` - Frontend integration
- `website/src/views/DashboardView.tsx` - Bot status management
- `website/firestore.rules` - Security rules (needs update)
