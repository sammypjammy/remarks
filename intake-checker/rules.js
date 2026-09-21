// Exact DeLorean labels. Optional fields are documented here, never required.
export const intakeRules = {
  sections: {
    "PERSONAL INFORMATION": {
      required: ["First Name", "Last Name", "Gender", "Social Security Number", "Phone Number", "Email"],
      optional: ["Middle Name", "Suffix", "Nickname", "Preferred Contact Method"]
    },
    "BIRTH INFORMATION": { required: ["Date of Birth", "City of Birth", "State of Birth", "Country of Birth"] },
    "ADDRESS INFORMATION": {
      required: ["Mailing Address - Street Address", "Mailing Address - City", "Mailing Address - State", "Mailing Address - Zipcode", "Physical Address - Street Address", "Physical Address - City", "Physical Address - State", "Physical Address - Zipcode"],
      optional: ["Mailing Address - Street Address 2", "Physical Address - Street Address 2"]
    },
    "LANGUAGE INFORMATION": {
      required: ["Preferred Language", "Can speak and understand English", "Can read simple English messages", "Can write simple English messages"],
      optional: ["Can read simple messages in preferred language", "Can write simple messages in preferred language"]
    },
    "SECURITY QUESTIONS": { required: ["Mother - First Name", "Mother - Maiden Name", "Father - First Name", "Father - Last Name"], optional: ["Other Legal Representative"] },
    "VEHICLES": { required: ["Own any vehicles"] },
    "VITALS": { required: ["Height (feet)", "Height (inches)", "Weight (pounds)"] },
    "EMPLOYMENT INFORMATION": { required: ["When did you last work", "Currently working"], otherFieldsOptional: true },
    "MARRIAGE INFORMATION": { required: ["Marital Status"] },
    "SCHOOL INFORMATION": {
      parent: "EDUCATION INFORMATION",
      required: ["Highest Grade Completed", "School name where highest grade completed", "Country where school located", "School City", "School State", "School Zip Code", "School End Date", "School Phone Number", "Teacher Name"],
      optional: ["School Address Line 1", "School Address Line 2"]
    },
    "CHILDREN INFORMATION": { required: [] }
  },
  optionalSections: ["DISABILITY INFORMATION", "FIRM ONLY INFORMATION", "SSI INFORMATION", "FINANCIAL SUPPORT", "MEDICAL INFORMATION", "OTHER NAMES", "WAGES AND EARNINGS", "WORKER'S COMPENSATION", "ADDITIONAL EMPLOYMENT QUESTIONS", "CITIZENSHIP INFORMATION", "SPECIALIZED TRAINING INFORMATION", "SPECIAL EDUCATION INFORMATION", "REMARKS/COMMENTS"],
  records: {
    vehicles: { section: "VEHICLES", heading: /^Vehicle(?: \d+)?$/, required: ["Year", "Make", "Model", "Mileage"] },
    providers: {
      section: "MEDICAL PROVIDERS", heading: /^(?:Clinic|Medical Provider|Provider|Hospital|Doctor)(?: \d+)?$/,
      required: ["Phone Number", "Address", "City", "State", "Zipcode"],
      optional: ["Clinic Name", "Doctor First Name", "Doctor Last Name", "Address 2", "Notes", "First Visit Date", "Next Visit Date"]
    },
    medications: { section: "MEDICATIONS", heading: /^Medication(?: \d+)?$/, required: ["Medication Name"], optional: ["Reason for taking", "Prescriber"] },
    jobs: {
      section: "WORK HISTORY", heading: /^(?:(?:Most Recent|Previous) Job|Job(?: \d+)?)$/,
      required: ["Job Title", "Employer", "Business Type", "Start Date", "End Date", "Hours per Day", "Days per Week", "Rate of Pay", "Pay Frequency"],
      currentYearAddress: ["Address", "City", "State", "Zipcode"]
    },
    spouse: {
      section: "MARRIAGE INFORMATION", heading: /^Current Spouse$/,
      required: ["First Name", "Last Name", "Marriage Date", "Birth Country", "Birth City", "Birth State", "Age", "City of Marriage", "State of Marriage", "Type of Marriage"],
      optional: ["Maiden Name", "Social Security Number"]
    },
    // No guessed child heading names: identify field-bearing records in CHILDREN INFORMATION.
    children: { section: "CHILDREN INFORMATION", required: [], recognition: ["First Name", "Last Name"], allowEmptyRecords: true, otherFieldsOptional: true }
  },
  medicalProblemLabel: /^Problem (?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|[1-9]\d*)$/,
  // TODO: Activate >10-year prior-marriage rules only after exact DeLorean labels are supplied.
  deferred: ["Prior-marriage duration and required details are not checked yet: exact DeLorean field labels are needed."]
};
