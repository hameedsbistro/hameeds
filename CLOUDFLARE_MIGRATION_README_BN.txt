RMP POS - Cloudflare Migration Build

এই ZIP-এ:
- index.html, admin.html, cashier.html, waiter.html, kitchen.html থেকে Supabase SDK/URL/key সরানো হয়েছে।
- Browser data access এখন Cloudflare Worker API -> D1 ব্যবহার করে।
- Admin image upload/remove এখন Worker -> R2 ব্যবহার করে।
- Staff login Worker দিয়ে হয় এবং browser-এ 12-hour signed token রাখা হয়; profiles.password API response-এ ফেরত আসে না।
- Existing page code preserve করার জন্য একটি lightweight Cloudflare D1 compatibility bridge inline রাখা হয়েছে।
- Realtime fallback 8-second visibility-aware refresh; hidden tab-এ polling হয় না।
- Cashier customer-call 1-second polling 8-second visibility-aware polling করা হয়েছে।
- Supabase CDN dependency সম্পূর্ণ সরানো হয়েছে।
- images/logo.png (~1.36 MB) -> images/logo.jpg (~122 KB), HTML references updated.
- Chart.js এবং QRCode.js রাখা হয়েছে কারণ admin.html-এ বাস্তবে ব্যবহৃত হচ্ছে। Tailwind রাখা হয়েছে কারণ UI styling এটির উপর নির্ভরশীল।

DEPLOY ORDER
1. worker/src/index.js + worker/wrangler.jsonc GitHub-এ deploy করুন।
2. Cloudflare Runtime RMP_API_SECRET Secret অবশ্যই configured রাখুন।
3. তারপর 5 HTML + images/logo.jpg Netlify/GitHub-এ deploy করুন।
4. Login/menu/order/KDS/admin image upload test করুন।
5. Supabase এখনই delete করবেন না; production verification শেষে dependency-zero confirm করে তারপর বন্ধ করুন।
