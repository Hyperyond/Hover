// Option lists for the stock-registration form. Hardcoded — real KYC apps
// would pull these from a service. Enough breadth here to stress AI's ability
// to navigate long select menus.

export const SUFFIXES = ['', 'Jr.', 'Sr.', 'II', 'III', 'IV'];

export const COUNTRIES = [
  'United States', 'Canada', 'United Kingdom', 'Australia', 'Germany',
  'France', 'Japan', 'China', 'India', 'Brazil', 'Mexico', 'South Korea',
  'Singapore', 'Hong Kong', 'Switzerland', 'Netherlands', 'Sweden',
  'Norway', 'Israel', 'Argentina', 'Spain', 'Italy', 'Ireland',
  'New Zealand', 'South Africa', 'Russia', 'Turkey', 'Saudi Arabia',
  'United Arab Emirates', 'Other',
];

export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
];

export const INDUSTRIES = [
  'Technology', 'Finance & Banking', 'Healthcare', 'Education',
  'Manufacturing', 'Retail', 'Real Estate', 'Energy & Utilities',
  'Transportation & Logistics', 'Media & Entertainment', 'Government',
  'Non-profit', 'Legal Services', 'Hospitality & Tourism',
  'Construction', 'Agriculture', 'Other',
];

export const INCOME_RANGES = [
  'Less than $25,000',
  '$25,000 – $50,000',
  '$50,000 – $100,000',
  '$100,000 – $200,000',
  '$200,000 – $500,000',
  '$500,000 or more',
];

export const NET_WORTH_RANGES = [
  'Less than $50,000',
  '$50,000 – $100,000',
  '$100,000 – $250,000',
  '$250,000 – $500,000',
  '$500,000 – $1,000,000',
  '$1,000,000 – $5,000,000',
  '$5,000,000 or more',
];

export const TAX_BRACKETS = [
  '0 – 10%', '10 – 12%', '12 – 22%', '22 – 24%',
  '24 – 32%', '32 – 35%', '35 – 37%',
];

export const INVESTMENT_OBJECTIVES = [
  'Capital preservation',
  'Income generation',
  'Balanced growth',
  'Long-term growth',
  'Speculation',
];

export const EXPERIENCE_LEVELS = [
  'None', '1 – 2 years', '3 – 5 years', '5 – 10 years', '10+ years',
];

export const FUNDING_SOURCES = [
  'ACH bank transfer',
  'Wire transfer',
  'Check',
  'Brokerage transfer (ACAT)',
];

export const INVESTMENT_TYPES = [
  'Stocks', 'Options', 'Bonds', 'ETFs', 'Mutual funds', 'Crypto', 'Futures',
];
