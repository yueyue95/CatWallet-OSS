export const DEMO_REFERENCE_DATE = "2026-09-15T12:00:00+08:00";
export const DEMO_TIME_ZONE = "Asia/Kuala_Lumpur";

export const demoFixtures = {
  accounts: [
    {
      name: "Everyday Account",
      type: "bank",
      openingBalance: 4285.75,
    },
    { name: "Demo Savings", type: "bank", openingBalance: 1875.5 },
    { name: "Demo Visa", type: "credit", creditLimit: 4200 },
  ],
  transactions: [
    { date: "2026-07-01", description: "Salary", amount: 6480, kind: "income" },
    { date: "2026-07-03", description: "Rent", amount: 1420, kind: "expense" },
    {
      date: "2026-07-08",
      description: "Groceries",
      amount: 186.45,
      kind: "expense",
    },
    { date: "2026-08-01", description: "Salary", amount: 6480, kind: "income" },
    { date: "2026-08-03", description: "Rent", amount: 1420, kind: "expense" },
    { date: "2026-08-09", description: "Books", amount: 74.9, kind: "expense" },
    {
      date: "2026-08-18",
      description: "Weekend Trip",
      amount: 358.7,
      kind: "expense",
    },
    { date: "2026-09-01", description: "Salary", amount: 6480, kind: "income" },
    { date: "2026-09-03", description: "Rent", amount: 1420, kind: "expense" },
    {
      date: "2026-09-06",
      description: "Groceries",
      amount: 212.35,
      kind: "expense",
    },
    {
      date: "2026-09-09",
      description: "Cat Food",
      amount: 63.8,
      kind: "expense",
    },
    {
      date: "2026-09-12",
      description: "Coffee",
      amount: 18.6,
      kind: "expense",
    },
    {
      date: "2026-09-14",
      description: "Card Repayment",
      amount: 320,
      kind: "expense",
      entryKind: "repayment",
    },
  ],
  installments: [
    {
      description: "Desk Lamp",
      amount: 89.95,
      total: 4,
      current: 2,
      retired: false,
    },
    {
      description: "Travel Backpack",
      amount: 57.4,
      total: 3,
      current: 3,
      retired: true,
    },
  ],
  commitments: [
    { name: "Home Internet", amount: 118, cadence: "monthly" },
    { name: "Music Plan", amount: 24.9, cadence: "monthly" },
  ],
  sinkingFunds: [
    {
      name: "Annual Insurance",
      currentAmount: 720,
      monthlyTarget: 120,
      targetAmount: 1440,
    },
  ],
  goals: [
    {
      name: "Emergency Cushion",
      currentAmount: 1620,
      targetAmount: 5000,
      deadline: "2027-06-30",
    },
  ],
  coolingItems: [
    { name: "Mechanical Keyboard", amountCents: 28900, coolingDays: 14 },
  ],
} as const;

const locales = ["en", "zh-CN"] as const;
const desktopPages = [
  { name: "dashboard-desktop", route: "/dashboard" },
  { name: "transactions-desktop", route: "/transactions" },
  { name: "reports-desktop", route: "/reports" },
  { name: "planning-desktop", route: "/installments" },
] as const;

export const screenshotTargets = locales.flatMap((locale) => [
  ...desktopPages.map(({ name, route }) => ({
    locale,
    relativePath: `docs/images/demo/${locale}/${name}.png`,
    route,
    viewport: { width: 1440, height: 900 },
  })),
  {
    locale,
    relativePath: `docs/images/demo/${locale}/dashboard-mobile.png`,
    route: "/dashboard",
    viewport: { width: 390, height: 844 },
  },
]);
