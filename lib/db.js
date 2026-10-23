const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
export async function r(...cmd) {
  const res = await fetch(URL_, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN }, body: JSON.stringify(cmd) });
  const j = await res.json();
  if (j.error) throw new Error('DB: ' + j.error);
  return j.result;
}
export const getJ = async k => { const v = await r('GET', k); return v ? JSON.parse(v) : null; };
export const setJ = (k, v) => r('SET', k, JSON.stringify(v));
