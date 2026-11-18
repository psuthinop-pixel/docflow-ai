// Standard Thai SME chart of accounts (TFRS for NPAEs layout), seeded per property.
// Codes and names are editable afterwards; `role` marks the accounts the journal generator posts to.
// See docs/ACCOUNTING.md.

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type AccountRole =
  | '' | 'cash' | 'bank' | 'input_vat' | 'input_vat_pending' | 'wht_prepaid'
  | 'fixed_asset' | 'accum_dep' | 'construction'
  | 'ap' | 'advances_payable' | 'director_loan' | 'output_vat' | 'pp36_payable' | 'wht_payable'
  | 'dep_expense';

export interface SeedAccount {
  code: string;
  name: string;
  name_th: string;
  type: AccountType;
  role?: AccountRole;
  /** Fixed assets: straight-line useful life in years, and the accumulated depreciation account. */
  life_years?: number;
  contra_code?: string;
}

export const ACCOUNT_TYPES: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];

export const SEED_ACCOUNTS: SeedAccount[] = [
  // 1 Assets
  { code: '1111', name: 'Cash on hand', name_th: 'เงินสด', type: 'asset', role: 'cash' },
  { code: '1112', name: 'Bank - current account', name_th: 'เงินฝากธนาคาร - กระแสรายวัน', type: 'asset', role: 'bank' },
  { code: '1113', name: 'Bank - savings account', name_th: 'เงินฝากธนาคาร - ออมทรัพย์', type: 'asset', role: 'bank' },
  { code: '1150', name: 'Input VAT', name_th: 'ภาษีซื้อ', type: 'asset', role: 'input_vat' },
  { code: '1151', name: 'Input VAT - not yet due', name_th: 'ภาษีซื้อยังไม่ถึงกำหนด', type: 'asset', role: 'input_vat_pending' },
  { code: '1160', name: 'Withholding tax prepaid', name_th: 'ภาษีเงินได้ถูกหัก ณ ที่จ่าย', type: 'asset', role: 'wht_prepaid' },
  { code: '1210', name: 'Land', name_th: 'ที่ดิน', type: 'asset', role: 'fixed_asset' },
  { code: '1220', name: 'Buildings & improvements', name_th: 'อาคารและส่วนปรับปรุงอาคาร', type: 'asset', role: 'fixed_asset', life_years: 20, contra_code: '1221' },
  { code: '1221', name: 'Accum. depreciation - buildings', name_th: 'ค่าเสื่อมราคาสะสม - อาคาร', type: 'asset', role: 'accum_dep' },
  { code: '1230', name: 'Furniture, fixtures & fittings (FF&E)', name_th: 'เครื่องตกแต่งและติดตั้ง', type: 'asset', role: 'fixed_asset', life_years: 5, contra_code: '1231' },
  { code: '1231', name: 'Accum. depreciation - FF&E', name_th: 'ค่าเสื่อมราคาสะสม - เครื่องตกแต่ง', type: 'asset', role: 'accum_dep' },
  { code: '1240', name: 'Hotel & office equipment', name_th: 'อุปกรณ์โรงแรมและสำนักงาน', type: 'asset', role: 'fixed_asset', life_years: 5, contra_code: '1241' },
  { code: '1241', name: 'Accum. depreciation - equipment', name_th: 'ค่าเสื่อมราคาสะสม - อุปกรณ์', type: 'asset', role: 'accum_dep' },
  { code: '1250', name: 'Computers', name_th: 'เครื่องคอมพิวเตอร์', type: 'asset', role: 'fixed_asset', life_years: 3, contra_code: '1251' },
  { code: '1251', name: 'Accum. depreciation - computers', name_th: 'ค่าเสื่อมราคาสะสม - คอมพิวเตอร์', type: 'asset', role: 'accum_dep' },
  { code: '1260', name: 'Vehicles', name_th: 'ยานพาหนะ', type: 'asset', role: 'fixed_asset', life_years: 5, contra_code: '1261' },
  { code: '1261', name: 'Accum. depreciation - vehicles', name_th: 'ค่าเสื่อมราคาสะสม - ยานพาหนะ', type: 'asset', role: 'accum_dep' },
  { code: '1290', name: 'Construction in progress', name_th: 'งานระหว่างก่อสร้าง', type: 'asset', role: 'construction' },
  // 2 Liabilities
  { code: '2110', name: 'Accounts payable', name_th: 'เจ้าหนี้การค้า', type: 'liability', role: 'ap' },
  { code: '2120', name: 'Advances payable - staff', name_th: 'เจ้าหนี้สำรองจ่าย - พนักงาน', type: 'liability', role: 'advances_payable' },
  { code: '2130', name: 'Loan from director', name_th: 'เงินกู้ยืมจากกรรมการ', type: 'liability', role: 'director_loan' },
  { code: '2150', name: 'Output VAT', name_th: 'ภาษีขาย', type: 'liability', role: 'output_vat' },
  { code: '2160', name: 'VAT payable - PP.36', name_th: 'ภาษีมูลค่าเพิ่มค้างจ่าย ภ.พ.36', type: 'liability', role: 'pp36_payable' },
  { code: '2170', name: 'Withholding tax payable', name_th: 'ภาษีหัก ณ ที่จ่ายค้างจ่าย', type: 'liability', role: 'wht_payable' },
  // 3 Equity
  { code: '3110', name: 'Share capital', name_th: 'ทุนจดทะเบียนที่ชำระแล้ว', type: 'equity' },
  { code: '3200', name: 'Retained earnings', name_th: 'กำไร (ขาดทุน) สะสม', type: 'equity' },
  // 4 Revenue
  { code: '4110', name: 'Room revenue', name_th: 'รายได้ค่าห้องพัก', type: 'revenue' },
  { code: '4120', name: 'Food & beverage revenue', name_th: 'รายได้อาหารและเครื่องดื่ม', type: 'revenue' },
  { code: '4190', name: 'Other income', name_th: 'รายได้อื่น', type: 'revenue' },
  // 5 Cost of sales (rooms)
  { code: '5110', name: 'Guest supplies & amenities', name_th: 'วัสดุสิ้นเปลืองห้องพัก', type: 'expense' },
  { code: '5120', name: 'Laundry', name_th: 'ค่าซักรีด', type: 'expense' },
  { code: '5130', name: 'OTA & booking commission', name_th: 'ค่านายหน้าการจอง', type: 'expense' },
  // 6 Operating expenses
  { code: '6110', name: 'Salaries & wages', name_th: 'เงินเดือนและค่าจ้าง', type: 'expense' },
  { code: '6120', name: 'Electricity', name_th: 'ค่าไฟฟ้า', type: 'expense' },
  { code: '6121', name: 'Water', name_th: 'ค่าน้ำประปา', type: 'expense' },
  { code: '6130', name: 'Repairs & maintenance', name_th: 'ค่าซ่อมแซมและบำรุงรักษา', type: 'expense' },
  { code: '6140', name: 'Office supplies', name_th: 'วัสดุสำนักงาน', type: 'expense' },
  { code: '6150', name: 'Travel & fuel', name_th: 'ค่าเดินทางและค่าน้ำมัน', type: 'expense' },
  { code: '6160', name: 'Software & subscriptions', name_th: 'ค่าซอฟต์แวร์และบริการออนไลน์', type: 'expense' },
  { code: '6170', name: 'Meals & entertainment', name_th: 'ค่ารับรอง', type: 'expense' },
  { code: '6180', name: 'Telephone & internet', name_th: 'ค่าโทรศัพท์และอินเทอร์เน็ต', type: 'expense' },
  { code: '6190', name: 'Professional fees', name_th: 'ค่าธรรมเนียมวิชาชีพ', type: 'expense' },
  { code: '6200', name: 'Bank charges', name_th: 'ค่าธรรมเนียมธนาคาร', type: 'expense' },
  { code: '6210', name: 'Insurance', name_th: 'ค่าเบี้ยประกันภัย', type: 'expense' },
  { code: '6220', name: 'Rent', name_th: 'ค่าเช่า', type: 'expense' },
  { code: '6230', name: 'Marketing & advertising', name_th: 'ค่าโฆษณาและส่งเสริมการขาย', type: 'expense' },
  { code: '6290', name: 'Depreciation', name_th: 'ค่าเสื่อมราคา', type: 'expense', role: 'dep_expense' },
  { code: '6900', name: 'Other expenses', name_th: 'ค่าใช้จ่ายอื่น', type: 'expense' },
];

/** Default accounts a new property posts to until the owner changes them. */
export const DEFAULT_BANK_CODE = '1112';
export const DEFAULT_CAPEX_CODE = '1230';

/** A first guess for a category's account, for the owner/accountant to confirm. Never saved on its own. */
const SUGGESTIONS: [RegExp, string][] = [
  [/asset|capex|ทรัพย์สิน|สินทรัพย์|ff&?e|furniture|เฟอร์นิเจอร์/i, '1230'],
  [/computer|laptop|คอมพิวเตอร์/i, '1250'],
  [/office|stationery|สำนักงาน|เครื่องเขียน/i, '6140'],
  [/transport|travel|fuel|petrol|taxi|grab|เดินทาง|น้ำมัน/i, '6150'],
  [/software|subscription|saas|ซอฟต์แวร์/i, '6160'],
  [/meal|food|entertain|อาหาร|รับรอง/i, '6170'],
  [/water|ประปา/i, '6121'],
  [/utilit|electric|ไฟฟ้า/i, '6120'],
  [/repair|maint|ซ่อม/i, '6130'],
  [/internet|phone|telephone|mobile|โทรศัพท์|อินเทอร์เน็ต/i, '6180'],
  [/laundry|ซัก/i, '5120'],
  [/amenit|guest suppl|toiletr|ของใช้ในห้อง|สิ้นเปลือง/i, '5110'],
  [/commission|ota|agoda|booking|นายหน้า/i, '5130'],
  [/salar|wage|payroll|เงินเดือน|ค่าจ้าง/i, '6110'],
  [/professional|legal|account|audit|ทนาย|บัญชี|สอบบัญชี/i, '6190'],
  [/bank fee|bank charge|ธรรมเนียมธนาคาร/i, '6200'],
  [/insurance|ประกัน/i, '6210'],
  [/rent|เช่า/i, '6220'],
  [/marketing|advert|โฆษณา|การตลาด/i, '6230'],
];

export function suggestAccount(category: string): string | null {
  for (const [re, code] of SUGGESTIONS) if (re.test(category)) return code;
  return null;
}
