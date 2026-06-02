require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

prisma.user.findMany({ 
  select: { id: true, email: true, name: true, role: true, email_verified: true, mfa_level: true } 
})
.then(users => { 
  console.log('Users in DB:', JSON.stringify(users, null, 2)); 
  return prisma.$disconnect();
})
.catch(e => { 
  console.error('Error:', e.message); 
  process.exit(1); 
});
