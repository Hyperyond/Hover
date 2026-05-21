// Form shape + step definitions for the brokerage-account wizard.

export type YN = 'yes' | 'no' | '';
export type Sex = 'male' | 'female' | 'other' | '';
export type Marital = 'single' | 'married' | 'divorced' | 'widowed' | '';
export type EmpStatus = 'employed' | 'self-employed' | 'retired' | 'student' | 'unemployed' | 'homemaker' | '';
export type Risk = 'low' | 'moderate' | 'high' | 'aggressive' | '';
export type AccountType = 'checking' | 'savings' | '';

export interface Form {
  // Personal
  firstName: string; middleName: string; lastName: string; suffix: string;
  dob: string; sex: Sex; marital: Marital; dependents: number;
  citizenship: string; usTaxResident: YN;
  foreignTaxCountry: string; foreignTaxId: string;
  ssn: string; phone: string; email: string;
  // Address
  street: string; apt: string; city: string; state: string; zip: string;
  yearsAtAddress: number;
  prevStreet: string; prevCity: string; prevState: string; prevZip: string;
  // Employment
  empStatus: EmpStatus; employer: string; jobTitle: string;
  industry: string; yearsEmployed: number;
  // Financial profile
  annualIncome: string; liquidNetWorth: string; totalNetWorth: string;
  taxBracket: string; investmentObjective: string; riskTolerance: Risk;
  volatilityTolerance: number;
  // Experience
  expStocks: string; expOptions: string; expMargin: string;
  expBonds: string; expCrypto: string;
  interestedIn: string[];
  // Disclosures
  isPEP: YN; pepDetails: string;
  isFinraAffiliated: YN; finraEmployer: string;
  isControlPerson: YN; controlPersonCompany: string;
  // Funding
  initialDeposit: number; fundingSource: string;
  bankRouting: string; bankAccount: string; accountType: AccountType;
  govIdName: string | null;
  // Agreements (shown on Review step)
  agreeCustomer: boolean; agreeMargin: boolean; agreePrivacy: boolean;
  agreeElectronic: boolean; agreeAccurate: boolean; agreeMarketing: boolean;
}

export const STEPS = [
  { id: 'personal',    label: 'Personal',    title: 'Personal information',     blurb: 'Legal name, identification, and citizenship.' },
  { id: 'address',     label: 'Address',     title: 'Mailing address',          blurb: 'Where statements and tax documents will be sent.' },
  { id: 'employment',  label: 'Employment',  title: 'Employment & income',      blurb: 'Required for FINRA suitability and AML rules.' },
  { id: 'financial',   label: 'Financial',   title: 'Investment profile',       blurb: 'Helps us tailor the trading permissions you qualify for.' },
  { id: 'disclosures', label: 'Disclosures', title: 'Regulatory disclosures',   blurb: 'A short series of yes/no questions required by FINRA.' },
  { id: 'funding',     label: 'Funding',     title: 'Fund your account',        blurb: 'How you will make your initial deposit + a copy of your ID.' },
  { id: 'review',      label: 'Review',      title: 'Review & submit',          blurb: 'Confirm everything is correct, accept terms, and submit.' },
] as const;

export type StepId = (typeof STEPS)[number]['id'];

export const initial: Form = {
  firstName: '', middleName: '', lastName: '', suffix: '',
  dob: '', sex: '', marital: '', dependents: 0,
  citizenship: 'United States', usTaxResident: '',
  foreignTaxCountry: '', foreignTaxId: '',
  ssn: '', phone: '', email: '',
  street: '', apt: '', city: '', state: '', zip: '',
  yearsAtAddress: 0,
  prevStreet: '', prevCity: '', prevState: '', prevZip: '',
  empStatus: '', employer: '', jobTitle: '',
  industry: '', yearsEmployed: 0,
  annualIncome: '', liquidNetWorth: '', totalNetWorth: '',
  taxBracket: '', investmentObjective: '', riskTolerance: '',
  volatilityTolerance: 5,
  expStocks: 'None', expOptions: 'None', expMargin: 'None',
  expBonds: 'None', expCrypto: 'None',
  interestedIn: [],
  isPEP: '', pepDetails: '',
  isFinraAffiliated: '', finraEmployer: '',
  isControlPerson: '', controlPersonCompany: '',
  initialDeposit: 0, fundingSource: '',
  bankRouting: '', bankAccount: '', accountType: '',
  govIdName: null,
  agreeCustomer: false, agreeMargin: false, agreePrivacy: false,
  agreeElectronic: false, agreeAccurate: false, agreeMarketing: false,
};
