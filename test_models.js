const apiKey = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
const models = ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite', 'gemini-pro-latest'];

async function test() {
  for (const m of models) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`, {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({contents:[{parts:[{text:"hi"}]}]})
    });
    const json = await res.json();
    console.log(m, res.status, json.error ? json.error.message.split('\n')[0] : 'SUCCESS');
  }
}
test();
