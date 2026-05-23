# WhatsApp Testing Guide

## Setup Instructions

### 1. Environment Variables

Add these to your `.env` file:

```env
# WhatsApp Business API
WHATSAPP_ACCESS_TOKEN=your_whatsapp_access_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_VERIFY_TOKEN=your_custom_verify_token
WHATSAPP_WEBHOOK_URL=https://your-domain.com/whatsapp/webhook

# AI Providers (add at least one)
GROQ_API_KEY=your_groq_key
TOGETHER_API_KEY=your_together_key
REPLICATE_API_TOKEN=your_replicate_token
GEMINI_API_KEY=your_gemini_key

# Database
DB_DATABASE=./data/reminder.db
```

### 2. WhatsApp Business Setup

1. **Get WhatsApp Business API Access**
   - Go to [Meta for Developers](https://developers.facebook.com/)
   - Create a WhatsApp Business App
   - Get your Access Token and Phone Number ID

2. **Configure Webhook**
   - Set webhook URL to: `https://your-domain.com/whatsapp/webhook`
   - Verify token should match `WHATSAPP_VERIFY_TOKEN`
   - Subscribe to `messages` field

### 3. Run the Application

```bash
# Install dependencies
npm install

# Start the server
npm run start:dev
```

The server will run on `http://localhost:3000`

## Testing Methods

### Method 1: Local Testing with ngrok

1. **Install ngrok**
   ```bash
   npm install -g ngrok
   ```

2. **Expose local server**
   ```bash
   ngrok http 3000
   ```

3. **Update webhook URL**
   - Copy ngrok URL (e.g., `https://abc123.ngrok.io`)
   - Set webhook to: `https://abc123.ngrok.io/whatsapp/webhook`

4. **Test with WhatsApp**
   - Send a message to your WhatsApp Business number
   - The system should respond automatically

### Method 2: Direct API Testing

1. **Send test message**
   ```bash
   curl -X POST http://localhost:3000/whatsapp/test/send \
     -H "Content-Type: application/json" \
     -d '{
       "phone": "1234567890",
       "message": "Remind me to call mom tomorrow at 3pm"
     }'
   ```

2. **Check user status**
   ```bash
   curl "http://localhost:3000/whatsapp/test/user?phone=1234567890"
   ```

### Method 3: Webhook Testing

1. **Verify webhook**
   ```bash
   curl "http://localhost:3000/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=your_token&hub.challenge=test_challenge"
   ```

2. **Simulate incoming message**
   ```bash
   curl -X POST http://localhost:3000/whatsapp/webhook \
     -H "Content-Type: application/json" \
     -d '{
       "object": "whatsapp_business_account",
       "entry": [{
         "changes": [{
           "field": "messages",
           "value": {
             "metadata": {"display_phone_number": "1234567890"},
             "messages": [{
               "from": "0987654321",
               "type": "text",
               "text": {"body": "Remind me to take medicine daily at 8am"}
             }]
           }
         }]
       }]
     }'
   ```

## Test Scenarios

### 1. Basic Reminder Creation
**Message**: "Remind me to call mom tomorrow at 3pm"
**Expected Response**: "Got it! I'll remind you to call mom tomorrow at 3pm"

### 2. Time Inference
**Message**: "Take medicine every morning"
**Expected Response**: "Sure thing! Take medicine reminder set for tomorrow at 8am"

### 3. Task Completion
**Message**: "I'm done with that call mom reminder"
**Expected Response**: "Awesome! I'll stop reminding you about calling mom"

### 4. Ambiguous Request
**Message**: "Remind me about the meeting"
**Expected Response**: "When would you like me to remind you about that?"

### 5. Complex Request
**Message**: "Remind me to exercise every weekday at 6pm"
**Expected Response**: "You got it! Exercise reminder scheduled for weekdays at 6pm"

## Monitoring

### Check AI Provider Status
```bash
curl http://localhost:3000/ai/status
```

### View Active Reminders
```bash
curl http://localhost:3000/reminders
```

### Check Scheduler Status
```bash
curl http://localhost:3000/reminders/stats/scheduler
```

## Troubleshooting

### Common Issues

1. **Webhook not receiving messages**
   - Check webhook URL is correct
   - Verify webhook is subscribed to `messages` field
   - Ensure ngrok is running if testing locally

2. **AI not responding**
   - Check AI provider API keys are valid
   - Verify free quotas haven't been exceeded
   - Check `/ai/status` for provider status

3. **Reminders not being sent**
   - Check scheduler is running (logs every minute)
   - Verify user notification preferences
   - Check WhatsApp API limits

4. **Database errors**
   - Ensure `data` directory exists
   - Check SQLite file permissions
   - Verify database schema is created

### Debug Mode

Enable debug logging:
```bash
DEBUG=* npm run start:dev
```

## Production Deployment

### 1. Use HTTPS
- WhatsApp requires HTTPS webhooks
- Use services like Vercel, Railway, or AWS

### 2. Environment Variables
- Set all required environment variables
- Use secure storage for API keys

### 3. Database
- Consider PostgreSQL for production
- Set up proper backups

### 4. Monitoring
- Set up health checks
- Monitor API usage and costs
- Set up alerts for failures

## Example Conversation

```
User: Remind me to take my medicine every day at 8am

AI: Got it! I'll remind you to take medicine every day at 8am

Reminder Details:
Title: Take medicine
Time: Tomorrow at 8:00 AM

I'll remind you when it's time!

---

(Next day at 8am)

AI: Hey John! Quick reminder: Take medicine

(30 minutes later if not completed)

AI: John, don't forget: Take medicine!

---

User: I already took my medicine

AI: Awesome! I'll stop reminding you about your medicine
```

## Tips for Testing

1. **Start simple**: Test basic reminder creation first
2. **Use ngrok**: Easy way to test locally
3. **Monitor logs**: Check console for errors
4. **Test variations**: Try different time formats and phrases
5. **Verify completion**: Test task completion detection
6. **Check persistence**: Ensure reminders repeat until completed

## Next Steps

Once basic testing is complete:
1. Set up persistent reminders
2. Test user preferences
3. Add more AI providers
4. Scale to multiple users
5. Add analytics and monitoring
