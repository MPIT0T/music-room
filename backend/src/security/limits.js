// Every limit in one place, so they can be reviewed and tuned together
export const limits = {
  // Contract v1.1: counted per email whether the account exists or not, so a 429 reveals nothing
  resendVerification: { name: 'resend-verification', limit: 1, windowSeconds: 60 },
  // 42 traffic leaves through one public IP: leave room for a whole cluster testing at once
  signup: { name: 'signup', limit: 30, windowSeconds: 60 * 60 },
  // Contract: 5 failed logins per 15 min for one IP + email (password guessing on one account)
  login: { name: 'login', limit: 5, windowSeconds: 15 * 60 },
  // Credential stuffing: one IP trying many emails. Generous, a 42 cluster shares one IP
  loginIp: { name: 'login-ip', limit: 50, windowSeconds: 15 * 60 },
};
