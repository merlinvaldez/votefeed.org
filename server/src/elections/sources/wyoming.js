// Reviewed source descriptor. Research progress and runtime coverage are separate.
export const wyomingSource = {
  id:'wy-2026-general', state:'WY', format:'wy-csv', authoritative:true,
  url:'https://sos.wyo.gov/Elections/Docs/2026/2026_WY_General_Election_Candidates.csv',
  allowedOrigins:['https://sos.wyo.gov'],
  authorityUrl:'https://sos.wyo.gov/elections/default.aspx',
  checkedAt:'2026-10-26T20:00:00Z', effectiveAt:null,
  completeness:'partial', // No separate general-election corrections audit yet.
  evidenceUrls:[
    'https://sos.wyo.gov/Elections/Docs/2026/2026_Key_Election_Dates.pdf',
    'https://sos.wyo.gov/Elections/Docs/2026/2026_Offices_Up_for_Election.pdf',
    'https://www.senate.gov/senators/Class_II.htm',
  ],
  races:[
    {label:'UNITED STATES REPRESENTATIVE',race:{office:'house',state:'WY',district:0,senateSeat:null,electionDate:'2026-11-03',stage:'general',contestType:'regular'}},
    {label:'UNITED STATES SENATOR',race:{office:'senate',state:'WY',district:null,senateSeat:2,electionDate:'2026-11-03',stage:'general',contestType:'regular'}},
  ],
};
