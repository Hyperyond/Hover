// Per-step validation. Each function returns an array of error strings —
// empty array means the step is OK to advance from.

import type { Form } from './types.ts';

function ageInYears(isoDate: string): number {
  if (!isoDate) return 0;
  const dob = new Date(isoDate);
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age;
}

function personal(f: Form): string[] {
  const e: string[] = [];
  if (!f.firstName.trim()) e.push('First name is required');
  if (!f.lastName.trim()) e.push('Last name is required');
  if (!f.dob) e.push('Date of birth is required');
  else if (ageInYears(f.dob) < 18) e.push('You must be at least 18 years old');
  if (!f.sex) e.push('Sex is required');
  if (!f.marital) e.push('Marital status is required');
  if (!f.citizenship) e.push('Country of citizenship is required');
  if (!f.usTaxResident) e.push('US tax residency status is required');
  if (f.usTaxResident === 'no') {
    if (!f.foreignTaxCountry) e.push('Foreign tax country is required');
    if (!f.foreignTaxId.trim()) e.push('Foreign tax ID is required');
  }
  if (!/^\d{3}-?\d{2}-?\d{4}$/.test(f.ssn)) e.push('SSN must be 9 digits (XXX-XX-XXXX)');
  if (!/^\d{10,}$/.test(f.phone.replace(/\D/g, ''))) e.push('Phone must have at least 10 digits');
  if (!f.email.includes('@')) e.push('A valid email is required');
  return e;
}

function address(f: Form): string[] {
  const e: string[] = [];
  if (!f.street.trim()) e.push('Street is required');
  if (!f.city.trim()) e.push('City is required');
  if (!f.state) e.push('State is required');
  if (!/^\d{5}$/.test(f.zip)) e.push('ZIP must be 5 digits');
  if (f.yearsAtAddress < 2 && f.yearsAtAddress >= 0 && !f.prevStreet.trim()) {
    e.push('Previous address is required (you have lived here less than 2 years)');
  }
  return e;
}

function employment(f: Form): string[] {
  const e: string[] = [];
  if (!f.empStatus) e.push('Employment status is required');
  if (f.empStatus === 'employed' || f.empStatus === 'self-employed') {
    if (!f.employer.trim()) e.push('Employer name is required');
    if (!f.jobTitle.trim()) e.push('Job title is required');
    if (!f.industry) e.push('Industry is required');
  }
  return e;
}

function financial(f: Form): string[] {
  const e: string[] = [];
  if (!f.annualIncome) e.push('Annual income is required');
  if (!f.liquidNetWorth) e.push('Liquid net worth is required');
  if (!f.totalNetWorth) e.push('Total net worth is required');
  if (!f.taxBracket) e.push('Tax bracket is required');
  if (!f.investmentObjective) e.push('Investment objective is required');
  if (!f.riskTolerance) e.push('Risk tolerance is required');
  return e;
}

function disclosures(f: Form): string[] {
  const e: string[] = [];
  if (!f.isPEP) e.push('Politically-exposed-person disclosure is required');
  if (f.isPEP === 'yes' && !f.pepDetails.trim()) e.push('PEP details are required');
  if (!f.isFinraAffiliated) e.push('FINRA affiliation disclosure is required');
  if (f.isFinraAffiliated === 'yes' && !f.finraEmployer.trim()) e.push('FINRA employer is required');
  if (!f.isControlPerson) e.push('Control-person disclosure is required');
  if (f.isControlPerson === 'yes' && !f.controlPersonCompany.trim()) {
    e.push('Control-person company is required');
  }
  return e;
}

function funding(f: Form): string[] {
  const e: string[] = [];
  if (!(f.initialDeposit > 0)) e.push('Initial deposit must be greater than $0');
  if (!f.fundingSource) e.push('Funding source is required');
  if (f.fundingSource === 'ACH bank transfer') {
    if (!/^\d{9}$/.test(f.bankRouting)) e.push('Bank routing number must be 9 digits');
    if (!/^\d{4,17}$/.test(f.bankAccount)) e.push('Bank account number must be 4-17 digits');
    if (!f.accountType) e.push('Bank account type is required');
  }
  if (!f.govIdName) e.push('Government ID photo is required');
  return e;
}

function review(f: Form): string[] {
  const e: string[] = [];
  if (!f.agreeCustomer) e.push('You must accept the Customer Agreement');
  if (!f.agreePrivacy) e.push('You must accept the Privacy Policy');
  if (!f.agreeElectronic) e.push('You must consent to electronic delivery');
  if (!f.agreeAccurate) e.push('You must confirm the information is accurate');
  return e;
}

export const VALIDATORS = [personal, address, employment, financial, disclosures, funding, review] as const;
