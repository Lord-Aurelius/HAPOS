import { requireSession } from '@/server/auth/demo-session';

const env = require('@/server/config/env');

export default async function AiSettingsPage() {
  const session = await requireSession(['shop_admin', 'super_admin']);

  const aiConfig = env?.ai || {};
  const enabled = Boolean(aiConfig.enabled);
  const defaultProvider = aiConfig.defaultProvider || 'disabled';
  const providers = [
    { name: 'openai', label: 'OpenAI', key: Boolean(aiConfig.openaiApiKey) },
    { name: 'deepseek', label: 'DeepSeek', key: Boolean(aiConfig.deepseekApiKey) },
    { name: 'openrouter', label: 'OpenRouter', key: Boolean(aiConfig.openrouterApiKey) },
    { name: 'gemini', label: 'Gemini', key: Boolean(aiConfig.geminiApiKey) },
    { name: 'anthropic', label: 'Anthropic', key: Boolean(aiConfig.anthropicApiKey) },
    { name: 'groq', label: 'Groq', key: Boolean(aiConfig.groqApiKey) },
    { name: 'ollama', label: 'Ollama', key: true },
  ];

  return (
    <>
      <section className="hero">
        <p className="hero-kicker">Artificial intelligence</p>
        <h1 className="hero-title">AI Business Intelligence settings.</h1>
          <p className="hero-subtitle">
          AEGIS analyses revenue, expenses, customers, services, and forecasts using your business data.
          Configure providers and models through environment variables &mdash; no code changes required.
        </p>
      </section>

      <section className="grid-two">
        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>AI status</h2>
              <p className="panel-copy">Current AI system status and active provider.</p>
            </div>
          </div>

          <div className="field-grid" style={{ marginTop: 8 }}>
            <div className="field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className={`pill`} style={{ background: enabled ? 'rgba(46, 160, 67, 0.12)' : 'rgba(160, 60, 46, 0.12)', color: enabled ? 'var(--success)' : 'var(--danger)' }}>
                {enabled ? 'Connected' : 'Disabled'}
              </span>
            </div>
            <div className="field">
              <label>Default provider</label>
              <p className="muted" style={{ marginTop: 4 }}>{defaultProvider}</p>
            </div>
            <div className="field">
              <label>Environment variables</label>
              <p className="muted" style={{ marginTop: 4 }}>
                AI_ENABLED={enabled ? 'true' : 'false'}, AI_DEFAULT_PROVIDER={defaultProvider}
              </p>
            </div>
          </div>
        </div>

        <div className="panel">
          <div className="panel-header">
            <div>
              <h2>Available providers</h2>
              <p className="panel-copy">Providers with API keys configured via environment variables.</p>
            </div>
          </div>

          <div className="field-grid" style={{ marginTop: 8 }}>
            {providers.map((p) => (
              <div key={p.name} className="field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="pill" style={{
                  background: p.key ? 'rgba(46, 160, 67, 0.12)' : 'rgba(160, 60, 46, 0.12)',
                  color: p.key ? 'var(--success)' : 'var(--danger)',
                }}>
                  {p.key ? 'Configured' : 'Missing key'}
                </span>
                <label style={{ margin: 0 }}>{p.label}</label>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Configuration guide</h2>
            <p className="panel-copy">Set these environment variables to configure AI. Models can be switched at any time without code changes.</p>
          </div>
        </div>

          <table className="table">
          <thead>
            <tr>
              <th>Variable</th>
              <th>Purpose</th>
              <th>Default</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><code>AI_ENABLED</code></td><td>Set to "true" to enable AEGIS</td><td>false</td></tr>
            <tr><td><code>AI_DEFAULT_PROVIDER</code></td><td>Default provider name</td><td>disabled</td></tr>
            <tr><td><code>AI_OLLAMA_BASE_URL</code></td><td>Ollama server URL</td><td>http://127.0.0.1:11434</td></tr>
            <tr><td><code>AI_OLLAMA_MODEL</code></td><td>Ollama model name</td><td>gemma4:31b</td></tr>
            <tr><td><code>AI_OLLAMA_KEEP_ALIVE</code></td><td>Ollama keep-alive duration</td><td>5m</td></tr>
            <tr><td><code>AI_OPENAI_API_KEY</code></td><td>OpenAI API key</td><td>—</td></tr>
            <tr><td><code>AI_OPENAI_MODEL</code></td><td>OpenAI model name</td><td>gpt-4o-mini</td></tr>
            <tr><td><code>AI_DEEPSEEK_API_KEY</code></td><td>DeepSeek API key</td><td>—</td></tr>
            <tr><td><code>AI_GEMINI_API_KEY</code></td><td>Google Gemini API key</td><td>—</td></tr>
            <tr><td><code>AI_ANTHROPIC_API_KEY</code></td><td>Anthropic API key</td><td>—</td></tr>
            <tr><td><code>AI_GROQ_API_KEY</code></td><td>Groq API key</td><td>—</td></tr>
          </tbody>
        </table>
      </section>
    </>
  );
}
