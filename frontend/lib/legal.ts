// Prepared explanations of the MSMED Act, 2006 delayed-payment rules (Chapter V).
// Written and reviewed by the team, not generated at run time. Not legal advice.

export const SOURCES = {
  indiaCode: { label: "India Code (search: Micro, Small and Medium Enterprises Development Act, 2006)", url: "https://www.indiacode.nic.in" },
  odr: { label: "MSME ODR portal (new delayed-payment references since 15 Oct 2025)", url: "https://odr.msme.gov.in" },
  rbi: { label: "Reserve Bank of India (Bank Rate announcements)", url: "https://www.rbi.org.in" },
};

export interface Provision { section: string; title: string; text: string; plain: string[] }

export const PROVISIONS: Provision[] = [
  {
    section: "Section 2(b)", title: "Appointed day and deemed acceptance",
    text: "The appointed day is the day after 15 days from the day the buyer accepts the goods or services, or is deemed to accept them. If the buyer raises no written objection within 15 days of delivery, the goods or services are deemed accepted on the day of delivery.",
    plain: ["Silence for 15 days after delivery counts as acceptance.", "A written objection within those 15 days stops the clock until it is resolved."],
  },
  {
    section: "Section 15", title: "When the buyer must pay",
    text: "The buyer must pay on or before the date agreed in writing. If nothing is agreed in writing, the buyer must pay before the appointed day. An agreed period can never be more than 45 days from acceptance or deemed acceptance.",
    plain: ["No written credit period: pay within 15 days of acceptance.", "Written credit period: the agreed date, capped at 45 days.", "A contract saying 60 or 90 days does not extend the 45-day limit."],
  },
  {
    section: "Section 16", title: "Interest on late payment",
    text: "If the buyer pays late, it owes compound interest with monthly rests at three times the Bank Rate notified by the RBI, from the appointed day or the day after the agreed date. This applies whatever the contract says.",
    plain: ["Rate: 3 × RBI Bank Rate, compounded monthly.", "A contract cannot lower or waive this rate in advance.", "Bank Rate changes over time; each period uses the rate then in force."],
  },
  {
    section: "Section 17", title: "Buyer's liability",
    text: "A buyer who has not paid is liable to pay the amount with the interest under Section 16.",
    plain: ["The claim is the unpaid amount plus Section 16 interest."],
  },
  {
    section: "Section 18", title: "Reference to the Facilitation Council",
    text: "Either party may refer a dispute about amounts due to the Micro and Small Enterprises Facilitation Council of the supplier's State. The Council first tries conciliation, then arbitrates if conciliation fails. New references are filed on the MSME ODR portal.",
    plain: ["The Council of the supplier's State has jurisdiction, even if the contract names another city.", "Conciliation first, then arbitration."],
  },
  {
    section: "Section 2(n) and 8", title: "Who is protected",
    text: "Only a micro or small enterprise that has registered (today, Udyam Registration) is a 'supplier'. Medium enterprises are not covered. Retail and wholesale traders were added to Udyam for priority-sector lending only (Ministry of MSME OM, 2 July 2021), not for these rights.",
    plain: ["Micro or small, Udyam-registered, manufacturing or services.", "The buyer can be any business, including another MSME.", "Registering after the contract date is a legally unsettled case (referred to a larger Supreme Court Bench in 2025)."],
  },
];

export interface QA { q: string; keywords: string[]; a: string; sections: string[] }

export const QAS: QA[] = [
  { q: "When does the buyer have to pay me?", keywords: ["when", "deadline", "due", "pay by", "45", "15 days", "how long", "time limit"],
    a: "It depends on whether a credit period was agreed in writing. If nothing was agreed, the buyer must pay within 15 days of accepting the goods (or of delivery, if they raised no written objection within 15 days). If a date was agreed in writing, that date applies, but it can never be more than 45 days after acceptance.",
    sections: ["Section 2(b)", "Section 15"] },
  { q: "How is interest on late payment calculated?", keywords: ["interest", "rate", "compound", "bank rate", "calculate", "how much"],
    a: "From the day after the payment deadline, interest runs at three times the RBI Bank Rate, compounded monthly: each month's interest is added to the balance and earns interest itself. The Bank Rate was 5.50% from 5 Dec 2025 and 5.75% from 7 Oct 2026, so the rate is 16.5% or 17.25% a year depending on the period. Use the calculator tab for an exact month-by-month figure.",
    sections: ["Section 16"] },
  { q: "Does the law apply to my business?", keywords: ["apply", "eligible", "eligibility", "covered", "trader", "medium", "udyam", "register", "qualify"],
    a: "It applies if you are a micro or small enterprise with Udyam Registration, in manufacturing or services. Medium enterprises and retail or wholesale traders are not covered. If you registered after the purchase order was signed, whether you can claim is currently unsettled in the courts. Check your Business Profile: the app shows the result for each case.",
    sections: ["Section 2(n) and 8"] },
  { q: "My contract says 90 days. Does that count?", keywords: ["contract", "90", "60", "agreement", "credit period", "longer", "terms"],
    a: "Only up to 45 days. Section 15 caps any agreed credit period at 45 days from acceptance, and Section 16 interest applies whatever the contract says. The app caps the due date automatically and shows a warning when it does.",
    sections: ["Section 15", "Section 16"] },
  { q: "The buyer says the goods were defective. What now?", keywords: ["defect", "defective", "quality", "objection", "reject", "dispute", "damaged", "complaint about goods"],
    a: "If the buyer objected in writing within 15 days of delivery, the goods are not deemed accepted until the objection is resolved, so no deadline or interest runs yet. Resolve it first with evidence such as test reports or delivery counts. If the objection came later than 15 days, deemed acceptance still applies, but the buyer can raise it as a counter-claim before the Council.",
    sections: ["Section 2(b)", "Section 18"] },
  { q: "What documents do I need for a case?", keywords: ["document", "documents", "evidence", "proof", "papers", "need"],
    a: "The purchase order, the invoices, proof of delivery (signed challan, e-way bill or courier record), a ledger extract showing what was paid, your Udyam certificate, and any emails or chats about payment or disputes. A written acceptance from the buyer helps but is not required. The evidence checklist tab shows what is on file for the selected invoice.",
    sections: ["Section 18"] },
  { q: "How do I file a complaint if the buyer won't pay?", keywords: ["file", "complaint", "odr", "samadhaan", "council", "msefc", "legal action", "court", "sue", "case"],
    a: "Eligible suppliers file a reference on the MSME ODR portal (odr.msme.gov.in), which has been the only route for new delayed-payment references since 15 October 2025. It goes to the Facilitation Council of your State, which tries conciliation and then arbitration. MSME Samadhaan is now only for older cases. Speak to a professional before filing.",
    sections: ["Section 18"] },
  { q: "How do I ask for payment without losing the customer?", keywords: ["relationship", "customer", "polite", "lose", "friendly", "gentle", "remind"],
    a: "Start with the gentlest step that is likely to work: a friendly reminder, then a firm one that mentions the due date and interest, and only then a formal demand. Offering to waive part of the interest for prompt payment is a commercial choice you can make. The Recovery Assistant suggests the step for each case and drafts the message for you to edit and send yourself.",
    sections: ["Section 16"] },
  { q: "Does late payment affect the buyer's taxes?", keywords: ["tax", "43b", "deduction", "income tax", "37"],
    a: "Yes. A buyer can deduct an amount owed to a micro or small enterprise and paid after the Section 15 limit only in the year it actually pays (Income-tax Act 1961 s.43B(h), carried into s.37(2)(g) of the Income-tax Act 2025), and Section 23 of the MSMED Act bars deducting the interest. Companies also report late MSE payments. These are points you can mention politely; check the details with a tax professional.",
    sections: ["Section 16"] },
  { q: "What changed in the 2026 amendment?", keywords: ["amendment", "2026", "new law", "changed", "change"],
    a: "The MSMED (Amendment) Act, 2026 adds timelines for the Council (mediation in 90 days, arbitration award within 90 days of pleadings), recovery of awards as arrears of land revenue, and TReDS settlement for central public sector buyers. Only some parts are in force: notification S.O. 5575(E) brought several sections into force from 15 Oct 2026 and one from 15 Dec 2026, but not the main dispute-timeline sections. The deadline and interest rules in Sections 15 and 16 are unchanged.",
    sections: ["Section 18"] },
];

export function answer(question: string): QA | null {
  const s = question.toLowerCase();
  let best: { qa: QA; score: number } | null = null;
  for (const qa of QAS) {
    const score = qa.keywords.reduce((n, k) => n + (s.includes(k) ? k.length : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { qa, score };
  }
  return best?.qa ?? null;
}
