export const electionNumberDigits = election => /senad/i.test(election?.election_types?.name || '') ? 3 : /deput/i.test(election?.election_types?.name || '') ? 4 : 2;
