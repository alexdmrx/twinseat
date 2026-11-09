// Quotas d'un compte (limites de 5 h et de la semaine), demandés à Claude
// Code lui-même : aucun mot de passe ni jeton touché, aucun message envoyé,
// donc aucun quota consommé. Sans vscode.
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Compte, dossierCompte, sousDossier } from "./chemins";
import { lireJson } from "./installation";

export interface Fenetre {
  pct: number;
  reset?: string;
}
export interface Quotas {
  compte: Compte;
  majLe: number; // ms
  source: "direct" | "cache";
  plan?: string;
  cinqHeures?: Fenetre;
  semaine?: Fenetre;
  erreur?: string;
}

function fenetre(w: unknown): Fenetre | undefined {
  if (!w || typeof w !== "object") return undefined;
  const o = w as { utilization?: unknown; used_percentage?: unknown; resets_at?: unknown };
  const pct = typeof o.utilization === "number" ? o.utilization : typeof o.used_percentage === "number" ? o.used_percentage : undefined;
  if (pct === undefined) return undefined;
  let reset: string | undefined;
  if (typeof o.resets_at === "string") reset = o.resets_at;
  else if (typeof o.resets_at === "number") reset = new Date(o.resets_at * 1000).toISOString();
  return { pct, reset };
}

/** Arguments de la sonde : ni crochets, ni serveurs MCP, ni historique. */
export const ARGS_SONDE = [
  "-p", "--output-format", "stream-json", "--input-format", "stream-json", "--verbose",
  "--no-session-persistence", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
  "--settings", '{"disableAllHooks":true}',
];

export function demanderQuotas(c: Compte, binaire: string, delaiMs = 30000, home = os.homedir()): Promise<Quotas> {
  return new Promise((resolve) => {
    const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_CONFIG_DIR: dossierCompte(c, home) };
    delete env.CLAUDE_COMPTE_FENETRE;
    let fini = false;
    const finir = (q: Omit<Quotas, "compte" | "majLe">) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuteur);
      try {
        enfant.stdin.end();
      } catch {
        /* déjà fermé */
      }
      setTimeout(() => enfant.kill(), 1500);
      resolve({ compte: c, majLe: Date.now(), ...q });
    };
    const enfant = spawn(binaire, ARGS_SONDE, { cwd: os.tmpdir(), env, stdio: ["pipe", "pipe", "ignore"] });
    const minuteur = setTimeout(() => finir({ source: "direct", erreur: "délai dépassé" }), delaiMs);
    enfant.on("error", (e) => finir({ source: "direct", erreur: e.message }));
    // Claude arrêté avant de lire : l'écriture échoue (EPIPE) sans faire tomber l'hôte.
    enfant.stdin.on("error", () => undefined);
    enfant.on("exit", () => finir({ source: "direct", erreur: "Claude s'est arrêté avant de répondre" }));
    const envoyer = (o: unknown) => enfant.stdin.write(`${JSON.stringify(o)}\n`);
    let tampon = "";
    enfant.stdout.on("data", (d: Buffer) => {
      tampon += d.toString("utf8");
      let i: number;
      while ((i = tampon.indexOf("\n")) >= 0) {
        const ligne = tampon.slice(0, i);
        tampon = tampon.slice(i + 1);
        let m: { type?: string; response?: { request_id?: string; subtype?: string; error?: string; response?: Record<string, unknown> } };
        try {
          m = JSON.parse(ligne);
        } catch {
          continue;
        }
        if (m.type !== "control_response" || !m.response) continue;
        const r = m.response;
        if (r.request_id === "init") {
          if (r.subtype === "error") return finir({ source: "direct", erreur: r.error ?? "erreur au démarrage" });
          envoyer({ type: "control_request", request_id: "usage", request: { subtype: "get_usage", skip_behaviors: true } });
        } else if (r.request_id === "usage") {
          if (r.subtype === "error") return finir({ source: "direct", erreur: r.error ?? "quotas indisponibles" });
          const u = r.response ?? {};
          const rl = (u.rate_limits ?? {}) as Record<string, unknown>;
          return finir({
            source: "direct",
            plan: typeof u.subscription_type === "string" ? u.subscription_type : undefined,
            cinqHeures: fenetre(rl.five_hour),
            semaine: fenetre(rl.seven_day),
            erreur: u.rate_limits_available === false ? "pas de limites (clé API ?)" : undefined,
          });
        }
      }
    });
    envoyer({ type: "control_request", request_id: "init", request: { subtype: "initialize" } });
  });
}

/** Roue de secours : les derniers chiffres gardés par Claude dans la fiche du compte. */
export function quotasEnCache(c: Compte, home = os.homedir()): Quotas | undefined {
  const fiche = lireJson(path.join(dossierCompte(c, home), ".claude.json"));
  const cache = fiche?.cachedUsageUtilization as { fetchedAtMs?: unknown; utilization?: Record<string, unknown> } | undefined;
  if (!cache || typeof cache.fetchedAtMs !== "number" || !cache.utilization) return undefined;
  return {
    compte: c,
    majLe: cache.fetchedAtMs,
    source: "cache",
    cinqHeures: fenetre(cache.utilization.five_hour),
    semaine: fenetre(cache.utilization.seven_day),
  };
}

const fichierQuotas = (c: Compte, home?: string) => path.join(sousDossier.quotas(home), `${c}.json`);

export function enregistrerQuotas(q: Quotas, home = os.homedir()): void {
  const f = fichierQuotas(q.compte, home);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const tmp = `${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(q));
  fs.renameSync(tmp, f);
}

/** Derniers quotas connus : fichier partagé, sinon cache de Claude. */
export function derniersQuotas(c: Compte, home = os.homedir()): Quotas | undefined {
  const q = lireJson(fichierQuotas(c, home)) as Quotas | undefined;
  const cache = quotasEnCache(c, home);
  if (q && !q.erreur && (q.cinqHeures || q.semaine)) {
    return cache && cache.majLe > q.majLe ? cache : q;
  }
  return cache ?? q;
}

/**
 * Un seul relevé à la fois pour toutes les fenêtres : verrou par fichier.
 * Un verrou de plus de 90 s est considéré comme abandonné.
 */
export function prendreVerrou(home = os.homedir()): boolean {
  const f = path.join(sousDossier.quotas(home), ".verrou");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  try {
    fs.writeFileSync(f, String(process.pid), { flag: "wx" });
    return true;
  } catch {
    try {
      if (Date.now() - fs.statSync(f).mtimeMs > 90_000) {
        fs.unlinkSync(f);
        fs.writeFileSync(f, String(process.pid), { flag: "wx" });
        return true;
      }
    } catch {
      /* une autre fenêtre l'a pris */
    }
    return false;
  }
}

export function rendreVerrou(home = os.homedir()): void {
  const f = path.join(sousDossier.quotas(home), ".verrou");
  try {
    // Seulement notre verrou : jamais celui d'une autre fenêtre.
    if (fs.readFileSync(f, "utf8").trim() !== String(process.pid)) return;
    fs.unlinkSync(f);
  } catch {
    /* déjà rendu */
  }
}

/** Le compte dépasse-t-il le seuil d'alerte sur une de ses deux limites ? */
export function auSeuil(q: Quotas | undefined, seuil = 90): Fenetre & { limite: "5 h" | "semaine" } | undefined {
  if (!q) return undefined;
  const maintenant = Date.now();
  const active = (f?: Fenetre) => f && f.pct >= seuil && (!f.reset || Date.parse(f.reset) > maintenant);
  if (active(q.cinqHeures)) return { ...q.cinqHeures!, limite: "5 h" };
  if (active(q.semaine)) return { ...q.semaine!, limite: "semaine" };
  return undefined;
}
