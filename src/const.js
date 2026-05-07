import { ApifyClient } from 'apify-client';
import "dotenv/config"

export const MAX_RPM = 12
export const COOLDOWN_MS = 65 * 1000

export const client = new ApifyClient({
    token: process.env.APIFY_API_KEY,
});

export const DAYS_POSTED = 2

export const urlQuery = {
    "urls": [
        "https://www.indeed.com/jobs?q=junior+software+engineer&l=California&sort=date&vjk=49034d0366905d1f",
        "https://www.indeed.com/jobs?q=junior%20software%20developer&l=California&sort=date",
        "https://www.indeed.com/jobs?q=associate+software+developer&l=California&sort=date&vjk=0b7c87cb4bd37b59",
        "https://www.indeed.com/jobs?q=jr+developer&l=California&from=searchOnDesktopSerp&g-recaptcha-response=0cAFcWeA5_B2GP2nHfKmIt_gTsbJxTe98Xvkk4NSKLldrsZvABPmVYl2uYqzVkez6fElbZhLIS_mPVjcNT-wmn1l_GYAC6Q5zVOlr2maqzuOhcko2637VNINRYaIJ6UQ0FxlHaZMrX728xeJdKu2V7Sd_t6T1r1QSC0hOtk_882kWz139HxFk18mVD2A7vuTyBMq-Tocp27TDmzuVgBEPGTS7kBxwmm7A85Yhuq_t8m1_P9JqTzKyXnveLAvIgvHsWtwlUP6yOZS6dkPvpl8e7V4_UukOIHtalkX7sVhDsMTghCt32PhE_GqMY0YpFfgKCwDC9RHsFEXbESh7iQLsF5Ma27_uowhaBI6rDxcd5wwzlM-ZkGd9G3WJ8k3GHqIozF1WY_gyG5JUlo35Ny9M1n7Aief3BlRPZVIeGmwFdud_ocfy1P9voVZm82l_PU3A_fw-0YVz5ni-tQHm4ELh6hGt_uijHMAOhhTvaJEqw27Q71Ff_3AfrJNWFR6BUVwwsjhV-IBE89U51mVlpS1Q_ctePd74G6sTHMmA9w0gZBMumeOA6CfZ0RlRdllE8yIPHjtczPHuVl-OnafEnfKV07W-9ymq9cZ7E9h8HfW968-5suMinzZmpJcPMdZuf4p19P7V0FtFlp7UiiC44mYOfv_ak-WkGHdWCKdZrvkevSTNBTuuImYe-rqIOR8jfYMxqlewNNZqfVx4lNsgkwrfdOLdROL_HGTi0UKa0Ih2dS4Xd3SGFTB05Rox3YLTelj_n0yuFyT1kwuCO4H8YNC1hAECxXtguwJ-dTbwlZWCZULYQDUiHf8hNOqFms7SurHd7OvJPA8YlcyL8tHfZSZ_9FXZtu-dgfQrZRc85OQQywxBcf4Nzg_Q4IpnqZgTOxl4UENPlVLgmL02kh-XGZCLltu7t5jtJ7WYDXtGdOssHCgc23AoNLSFEE5P7CJ3T1sgQvlqDCMiaMxcmWSRuffavNCODodnq9vbpdMc6tFhOVA-unRlq01-CpK78tPu713kgWkGFglCLfLAsCcEvGIdsFT6S4sv8y6ijKxDdPINBtoU3OBvbBqekjOO6zLl8eNJZHhb5uH3ttUenc5dibVpSP5ZoRuw5k21HAs_mb5otOyMythw3GODphO-U8fSsPZNgSfBB5yNpIFjprtToagTJ2rjUFroKTx5T0jQNfDgkqX-CXFoYUT5o42LoKmFA0fTB6VCnZfBwBdmuYea92anWa2cVQc0R8Fily4RYMOE4_RAJJahVtu8VCa1ZMyaliUZJ2Z1h3imGzeiHmIC1w7vkIMT7viU1TWWkRJQQVfvMNr12WH9kCqN7YaTfBHc8917CYEhZkuCO-C4k43BjEBVFjwgzoTk2eHOuJ2TiMzlb6rz2cLL_-2VQekr-QPgFWneX2XzHgRrLctqdDFrPhwg4fKkZhnX0o_J_Ff3AdvsMD-yXeK7WcpnKo26k1GGgNEESmlm5eS9t3bSE8PTJEjLZYCPD3ew8bjGozCV3CtZPGkJFomb540Gxv99tLMBw-fgylYt5D_s0GagApC_fQrDCk3d2lAWtc5_r1L8Sm8WeIdxyQWvjmZZvGjFEGnfFlhJc02dNPYbsMTP7uw3tMwD-kvWFeUKD5d7HPZi6OyRFnLU66TXc-kg8VHedGNrWr3wjQ6V0OIVQcmMoR0LHvqSILzpUDjyLnMl3VkRnMopdB1ym7V84XoJ49AovoAh5rcSNRb5tXw6yPDBpFeEgm8jKGjaJmi16I-r8-qPbe8b8rKPwU47tKbmBFa4W_BOt_V1l26nF9U_-DbMvUoNlL6RMPz4omzvslZpIvoRk5mdJzq8ZE7gPV7McvofQQ0N2-ZFSIvMo_pUsxntWFJqf3orUEHdRJcpP5gEtenIT4rCY85uZ1ZGohXJ3fymi62iXJaw-29boIJ9oed90Xqmjn5E_ZFmVxenP2adaqU67qVNc7mEDM3U9n4vtroCvvVg0sR99TIxObrJCUZ6aMEBGYKJNY_1Ql_NykKGvr6QBN6ApUVJJDIznu8JU_vB5u86WrjGCHjUXTYmsR03FCFoUb_vfVN-hGeKqMnkGdl93miNeb0tld7R7myW2YW-X_OHWVXxo1V7pFRqUQMIJ3hiRVgVc_0wzzpETtDLYvyTcu1JTR4jqFwSQhnXfFi_oylLCkrzJbEmz3craDsC2bkhqwZ37hJ133IWIk6i1F5ga6Mn8ckvEk0J7HwTOfTiKtDGFiP78HBhkLXWnO766&vjk=0dd94b50c8e2f878",
        "https://www.indeed.com/jobs?q=jr+developer&l=California&from=searchOnHP&vjk=0dd94b50c8e2f878",
    ],
    "maxRowsPerUrl": 30,
};

// const query = {
//     "country": "us",
//     "query": "junior software engineer",
//     "location": "California",
//     "maxRows": 50,
//     "sort": "date",
//     "fromDays": "1",
//     "enableUniqueJobs": true,
//     "includeSimilarJobs": true
// };

export const SYSTEM_PROMPT = `
I'm a new grad looking to find my first software engineering job. I have 0 years of professional experience and no internships. 
I'll show you my resume, and I need you to use your best judgement on what's worth applying to, basically what I'll actually hear back from, and determining it's the kind of job im looking for, eg entry level dev.
I am mainly targeting full stack roles, you might see alot of low level stuff on my resume, but it's alot of fluff. The Ecommerce is really my flagship project.
I'll take an embedded role (or whatever role I can get), but full stack is the goal. If not, then front end, or backend is okay too.
The main thing goal is, i want to avoid jobs that I reasonably am unqualified for, and not worth applying to. secondly, prioritizing the job postints ill most likely hear back from.

Some things to watch out for: 
- internships are commonly for active students; which I am not. If it's internship, decern whether it accepts new grads, or only current students.
- jobs requiring security clearance typically are willing hire those without one. But some jobs do require a security clearance before, so verify if it come sup. 

Job posting might say like 1 year experience, but try to discern whether it comes across as a hard requirement, or maybe not, eg if it says junior / entry level position. 

secondly I want you to assign a score to the job based on 1-10. Give any job im unqualified for a 0. Give it a 1-9 based on what we've talked about. 
1 might be a new grad role thats a very hard reach, but possible. 5 might be something reasonable but not with my tech stack. 10 would be really close tech stack, and a junior full stack position.

OUTPUT (valid JSON only, no markdown, no preamble):
{
  "score": number (0 or 1-10),
  "yoe": "exact years of professional experience the job is asking for.",
  "reason": "one blunt sentence explaining the score. make it concise, without fluff. "
}
`.trim();