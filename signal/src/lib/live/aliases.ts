/**
 * Curated name → ticker aliases for widely covered US companies, so headlines that name a company
 * (without a cashtag) can be linked. Only distinctive names are listed; ambiguous common words are
 * excluded to avoid false links. Anything not matched is simply not linked.
 */
export const LIVE_ALIASES: Record<string, string> = {
  apple: "AAPL", microsoft: "MSFT", nvidia: "NVDA", amazon: "AMZN", alphabet: "GOOGL", google: "GOOGL", meta: "META",
  facebook: "META", tesla: "TSLA", "berkshire hathaway": "BRK.B", berkshire: "BRK.B", jpmorgan: "JPM", "jp morgan": "JPM",
  "goldman sachs": "GS", "morgan stanley": "MS", "bank of america": "BAC", citigroup: "C", citi: "C", "wells fargo": "WFC",
  blackrock: "BLK", "charles schwab": "SCHW", mastercard: "MA", paypal: "PYPL", "american express": "AXP",
  exxon: "XOM", exxonmobil: "XOM", chevron: "CVX", conocophillips: "COP", occidental: "OXY",
  walmart: "WMT", costco: "COST", "home depot": "HD", "procter & gamble": "PG", "coca-cola": "KO", pepsico: "PEP",
  "mcdonald's": "MCD", starbucks: "SBUX", nike: "NKE", disney: "DIS", netflix: "NFLX", comcast: "CMCSA",
  "unitedhealth": "UNH", "eli lilly": "LLY", "johnson & johnson": "JNJ", pfizer: "PFE", merck: "MRK", abbvie: "ABBV",
  amgen: "AMGN", moderna: "MRNA", "bristol myers": "BMY", "novo nordisk": "NVO",
  broadcom: "AVGO", amd: "AMD", "advanced micro devices": "AMD", intel: "INTC", qualcomm: "QCOM", micron: "MU",
  "texas instruments": "TXN", "applied materials": "AMAT", "lam research": "LRCX", tsmc: "TSM", "taiwan semiconductor": "TSM",
  asml: "ASML", arm: "ARM", oracle: "ORCL", salesforce: "CRM", adobe: "ADBE", ibm: "IBM", cisco: "CSCO",
  servicenow: "NOW", palantir: "PLTR", snowflake: "SNOW", crowdstrike: "CRWD", "palo alto networks": "PANW",
  shopify: "SHOP", uber: "UBER", airbnb: "ABNB", "booking holdings": "BKNG", spotify: "SPOT", coinbase: "COIN",
  boeing: "BA", lockheed: "LMT", "lockheed martin": "LMT", "rtx": "RTX", raytheon: "RTX", caterpillar: "CAT", deere: "DE",
  "general electric": "GE", honeywell: "HON", "3m": "MMM", ups: "UPS", fedex: "FDX",
  "delta air lines": "DAL", "united airlines": "UAL", "american airlines": "AAL", "southwest airlines": "LUV",
  ford: "F", "general motors": "GM", rivian: "RIVN", stellantis: "STLA", toyota: "TM",
  "at&t": "T", verizon: "VZ", "t-mobile": "TMUS", "dollar general": "DG", "target corp": "TGT", "best buy": "BBY",
  "lowe's": "LOW", "kroger": "KR", "walgreens": "WBA", "cvs health": "CVS", "intuit": "INTU", "dell": "DELL",
  "hp inc": "HPQ", "super micro": "SMCI", "supermicro": "SMCI", "warner bros": "WBD", paramount: "PARA",
};
