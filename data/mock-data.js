// DocFlow AI - Mock Data
window.MockData = {
    companies: [
        { id: 'c1', name: 'TechVision Co., Ltd.', color: '#6366f1', short: 'TV' },
        { id: 'c2', name: 'Green Logistics Ltd.', color: '#10b981', short: 'GL' },
        { id: 'c3', name: 'Sunrise Media Group', color: '#f59e0b', short: 'SM' },
    ],

    categories: ['Food & Beverage', 'Transport', 'Software & SaaS', 'Office Supplies', 'Utilities', 'Marketing', 'Travel', 'Other'],

    expenses: [
        { id: 'e1', companyId: 'c1', vendor: 'Amazon Web Services', date: '2026-02-18', amount: 8450, currency: 'THB', category: 'Software & SaaS', status: 'confirmed', source: 'email', tax: 592 },
        { id: 'e2', companyId: 'c1', vendor: 'Grab Thailand', date: '2026-02-17', amount: 320, currency: 'THB', category: 'Transport', status: 'confirmed', source: 'line', tax: 22 },
        { id: 'e3', companyId: 'c1', vendor: 'Starbucks Siam Paragon', date: '2026-02-16', amount: 450, currency: 'THB', category: 'Food & Beverage', status: 'pending', source: 'upload', tax: 31 },
        { id: 'e4', companyId: 'c2', vendor: 'PTT Station Bangna', date: '2026-02-20', amount: 2100, currency: 'THB', category: 'Transport', status: 'confirmed', source: 'upload', tax: 147 },
        { id: 'e5', companyId: 'c2', vendor: 'Central Purchasing', date: '2026-02-19', amount: 5670, currency: 'THB', category: 'Office Supplies', status: 'confirmed', source: 'email', tax: 397 },
        { id: 'e6', companyId: 'c3', vendor: 'Facebook Ads', date: '2026-02-21', amount: 12000, currency: 'THB', category: 'Marketing', status: 'confirmed', source: 'email', tax: 840 },
        { id: 'e7', companyId: 'c3', vendor: 'Canva Pro', date: '2026-02-15', amount: 1290, currency: 'THB', category: 'Software & SaaS', status: 'confirmed', source: 'email', tax: 90 },
        { id: 'e8', companyId: 'c1', vendor: 'AIS Business', date: '2026-02-14', amount: 3200, currency: 'THB', category: 'Utilities', status: 'confirmed', source: 'email', tax: 224 },
        { id: 'e9', companyId: 'c1', vendor: 'Lazada Business', date: '2026-02-13', amount: 1850, currency: 'THB', category: 'Office Supplies', status: 'pending', source: 'upload', tax: 130 },
        { id: 'e10', companyId: 'c2', vendor: 'Thai Airways', date: '2026-02-12', amount: 15600, currency: 'THB', category: 'Travel', status: 'confirmed', source: 'email', tax: 1092 },
        { id: 'e11', companyId: 'c1', vendor: 'Google Workspace', date: '2026-02-10', amount: 2100, currency: 'THB', category: 'Software & SaaS', status: 'confirmed', source: 'email', tax: 147 },
        { id: 'e12', companyId: 'c3', vendor: 'Shopee Ads', date: '2026-02-08', amount: 8900, currency: 'THB', category: 'Marketing', status: 'confirmed', source: 'email', tax: 623 },
    ],

    monthlyData: {
        labels: ['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb'],
        companies: {
            c1: [28400, 31200, 27800, 35600, 42100, 29300, 16370],
            c2: [41200, 38900, 44500, 39800, 51200, 47600, 23370],
            c3: [19800, 22400, 18600, 24100, 28500, 21900, 22190],
        }
    },

    categoryData: {
        c1: { 'Software & SaaS': 13750, 'Transport': 320, 'Food & Beverage': 450, 'Utilities': 3200, 'Office Supplies': 1850, 'Marketing': 0, 'Travel': 0, 'Other': 0 },
        c2: { 'Software & SaaS': 0, 'Transport': 2100, 'Food & Beverage': 0, 'Utilities': 0, 'Office Supplies': 5670, 'Marketing': 0, 'Travel': 15600, 'Other': 0 },
        c3: { 'Software & SaaS': 1290, 'Transport': 0, 'Food & Beverage': 0, 'Utilities': 0, 'Office Supplies': 0, 'Marketing': 20900, 'Travel': 0, 'Other': 0 },
    },

    emailReceipts: [
        { id: 'er1', from: 'noreply@aws.amazon.com', subject: 'AWS Invoice - February 2026', amount: 8450, vendor: 'Amazon Web Services', date: '2026-02-18', category: 'Software & SaaS' },
        { id: 'er2', from: 'billing@google.com', subject: 'Google Workspace - Feb Receipt', amount: 2100, vendor: 'Google Workspace', date: '2026-02-10', category: 'Software & SaaS' },
        { id: 'er3', from: 'no-reply@shopee.co.th', subject: 'Shopee Ads Invoice #SH2026021', amount: 8900, vendor: 'Shopee Ads', date: '2026-02-08', category: 'Marketing' },
        { id: 'er4', from: 'billing@canva.com', subject: 'Canva Pro Receipt - Feb 2026', amount: 1290, vendor: 'Canva Pro', date: '2026-02-15', category: 'Software & SaaS' },
        { id: 'er5', from: 'central@central.co.th', subject: 'Order Confirmation #CNT-88821', amount: 5670, vendor: 'Central Purchasing', date: '2026-02-19', category: 'Office Supplies' },
    ],

    lineMessages: [
        { id: 'lm1', sender: 'Somchai K.', avatar: 'SK', time: '13:45', message: 'ส่งใบเสร็จค่าน้ำมัน', imageUrl: null, amount: 2100, vendor: 'PTT Station', category: 'Transport', status: 'pending' },
        { id: 'lm2', sender: 'Nisa P.', avatar: 'NP', time: '11:20', message: 'ใบเสร็จ Starbucks ค่ะ', imageUrl: null, amount: 450, vendor: 'Starbucks', category: 'Food & Beverage', status: 'imported' },
        { id: 'lm3', sender: 'Arthit M.', avatar: 'AM', time: '09:05', message: 'ค่า Grab ไปประชุม', imageUrl: null, amount: 320, vendor: 'Grab Thailand', category: 'Transport', status: 'imported' },
        { id: 'lm4', sender: 'Malee S.', avatar: 'MS', time: 'Yesterday', message: 'ค่าอุปกรณ์สำนักงาน', imageUrl: null, amount: 1850, vendor: 'Lazada Business', category: 'Office Supplies', status: 'pending' },
    ],

    driveFiles: [
        { id: 'df1', name: 'AWS_Invoice_Feb2026.pdf', company: 'c1', year: '2026', month: 'February', size: '142 KB', date: '2026-02-18', type: 'pdf' },
        { id: 'df2', name: 'Grab_Receipt_0217.png', company: 'c1', year: '2026', month: 'February', size: '58 KB', date: '2026-02-17', type: 'image' },
        { id: 'df3', name: 'Facebook_Ads_Feb.pdf', company: 'c3', year: '2026', month: 'February', size: '89 KB', date: '2026-02-21', type: 'pdf' },
        { id: 'df4', name: 'Thai_Airways_Feb.pdf', company: 'c2', year: '2026', month: 'February', size: '203 KB', date: '2026-02-12', type: 'pdf' },
        { id: 'df5', name: 'Central_Receipt.pdf', company: 'c2', year: '2026', month: 'February', size: '76 KB', date: '2026-02-19', type: 'pdf' },
    ],

    activity: [
        { type: 'ocr', icon: '🔍', text: 'OCR processed: Starbucks receipt — ฿450', time: '5 min ago', company: 'c1' },
        { type: 'email', icon: '📧', text: 'Email scraped: Google Workspace invoice — ฿2,100', time: '18 min ago', company: 'c1' },
        { type: 'line', icon: '💬', text: 'LINE submission: Grab transport — ฿320', time: '1 hr ago', company: 'c1' },
        { type: 'sheets', icon: '📊', text: 'Synced 3 new rows to Google Sheets', time: '2 hr ago', company: 'c2' },
        { type: 'drive', icon: '📁', text: 'Organized 2 files to Drive: Green Logistics / 2026 / February', time: '3 hr ago', company: 'c2' },
        { type: 'email', icon: '📧', text: 'Email scraped: Shopee Ads invoice — ฿8,900', time: 'Yesterday', company: 'c3' },
        { type: 'ocr', icon: '🔍', text: 'OCR processed: PTT fuel receipt — ฿2,100', time: 'Yesterday', company: 'c2' },
    ]
};
