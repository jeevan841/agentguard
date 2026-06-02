# 🚀 Quick Start: Login to AgentGuard

## Problem: "Authentication failed" when trying to login

**Root Cause:** No user account exists in the database yet. The demo credentials shown on the login page are just placeholders.

---

## ✅ Solution: Create Your First User Account

### Option 1: Register via Frontend UI (Recommended)

1. **Go to the login page:**
   ```
   http://localhost:3000
   ```

2. **Click "Register" tab** (top of the login form)

3. **Fill in the registration form:**
   - **Full Name:** Your Name
   - **Email:** admin@agentguard.io (or any email you want)
   - **Password:** Choose a secure password (min 8 characters)

4. **Click "Create Account"**

5. **Verify your email:**
   - Open Mailpit: http://localhost:8025
   - Find the verification email
   - Click the verification link

6. **Now you can login!**
   - Go back to http://localhost:3000
   - Click "Sign In" tab
   - Enter your email and password
   - Click "Sign In"

---

### Option 2: Create User via Backend Seed Script

If you want to quickly create a demo admin user:

1. **Open terminal in the backend directory:**
   ```bash
   cd backend
   ```

2. **Run the seed script:**
   ```bash
   node seed.js
   ```

3. **This creates a default admin user:**
   - **Email:** admin@agentguard.io
   - **Password:** admin123
   - **Email Verified:** Yes (automatically)
   - **MFA Level:** 1 (password only)

4. **Now login with these credentials:**
   - Go to http://localhost:3000
   - Email: admin@agentguard.io
   - Password: admin123
   - Click "Sign In"

---

### Option 3: Create User via API (Advanced)

If you prefer using curl or Postman:

```bash
# 1. Register a new user
curl -X POST http://localhost:4000/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@agentguard.io",
    "password": "SecurePassword123",
    "name": "Admin User"
  }'

# 2. Get the verification token from Mailpit
# Open http://localhost:8025 and copy the token from the email

# 3. Verify the email
curl "http://localhost:4000/auth/verify-email?token=YOUR_TOKEN_HERE"

# 4. Now you can login
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@agentguard.io",
    "password": "SecurePassword123"
  }'
```

---

## 🔍 Troubleshooting

### Issue: "Cannot connect to backend"

**Check if backend is running:**
```bash
curl http://localhost:4000/health
```

**Expected response:**
```json
{
  "status": "ok",
  "services": {
    "database": "ok",
    "redis": "ok"
  }
}
```

**If not running, start it:**
```bash
cd backend
npm start
```

---

### Issue: "Database connection failed"

**Start PostgreSQL:**
```bash
docker compose up postgres -d
```

**Apply database schema:**
```bash
cd backend
npx prisma db push
```

---

### Issue: "Redis connection failed"

**Start Redis:**
```bash
docker compose up redis -d
```

---

### Issue: "Email verification link doesn't work"

**Check Mailpit is running:**
```bash
docker compose up mailpit -d
```

**Access Mailpit UI:**
```
http://localhost:8025
```

---

### Issue: "Seed script fails"

**Make sure database is ready:**
```bash
cd backend
npx prisma db push
node seed.js
```

---

## 📋 Complete Setup Checklist

Run these commands to ensure everything is set up:

```bash
# 1. Start all services
docker compose up -d

# 2. Check all services are running
docker compose ps

# 3. Apply database schema
cd backend
npx prisma db push

# 4. Create demo user (optional)
node seed.js

# 5. Check backend health
curl http://localhost:4000/health

# 6. Open frontend
# Visit http://localhost:3000
```

---

## 🎯 Quick Login Steps (After Setup)

1. ✅ Make sure all services are running
2. ✅ Create a user account (register or seed)
3. ✅ Verify email (if registered via UI)
4. ✅ Go to http://localhost:3000
5. ✅ Enter your credentials
6. ✅ Click "Sign In"

---

## 💡 Understanding MFA Levels

After you login successfully, you can configure Multi-Factor Authentication:

### Level 1 (Default)
- **Password only**
- Quick login, less secure
- Good for development

### Level 2
- **Password + Email OTP**
- 6-digit code sent to email
- Better security

### Level 3
- **Password + Email OTP + TOTP**
- Requires authenticator app (Google Authenticator, Authy)
- Maximum security
- Recommended for production

**To enable MFA:**
1. Login successfully
2. Go to Settings page
3. Click "Enable Two-Factor Authentication"
4. Scan QR code with authenticator app
5. Enter code to confirm

---

## 🚀 You're All Set!

After following these steps, you should be able to:
- ✅ Register new users
- ✅ Login successfully
- ✅ Access the dashboard
- ✅ Create agents
- ✅ Run guardrail checks
- ✅ View audit logs

---

## 📞 Still Having Issues?

Check the backend logs for detailed error messages:

```bash
# If running with npm
# Check the terminal where you ran 'npm start'

# If running with Docker
docker logs agentguard_backend

# Check frontend logs
docker logs agentguard_frontend
```

Common error messages and solutions:

| Error | Solution |
|-------|----------|
| "Invalid email or password" | User doesn't exist, register first |
| "Please verify your email" | Check Mailpit and click verification link |
| "Network Error" | Backend not running, start it |
| "Database connection failed" | Start PostgreSQL with docker compose |
| "Redis connection failed" | Start Redis with docker compose |

---

**Need more help?** Check `FUNCTIONALITY_CHECK.md` for comprehensive testing and troubleshooting guides.