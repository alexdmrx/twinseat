import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { cleProjetLanceur, dossierCompte, estNumeroConversation } from "../chemins";
import { ficheDeDepart, infosCompte, installer } from "../installation";
import { auSeuil, Quotas } from "../quotas";
import { cheminPs, conversationsVivantes, ecrireCompte, ecrireCompteProjet, lireCompte, lireCompteProjet } from "../registre";

const LANCEUR = path.resolve(__dirname, "../../resources/lanceur.sh");
const maison = () => fs.mkdtempSync(path.join(os.tmpdir(), "comptes-test-"));

test("cleProjetLanceur = tr -c 'A-Za-z0-9' '-' du shell (espaces, accents)", () => {
  for (const p of ["/Users/jane/Desktop/dossier sans titre/projet", "/tmp/été à Noël/projet 2", "/a/b-c_d.e"]) {
    const attendu = execFileSync("/bin/sh", ["-c", `printf '%s' "$1" | LC_ALL=C tr -c 'A-Za-z0-9' '-'`, "sh", p], { encoding: "utf8" });
    assert.equal(cleProjetLanceur(p), attendu);
  }
});

test("ficheDeDepart : jamais l'identité, garde mcpServers, projects, migrations", () => {
  const f = ficheDeDepart({
    oauthAccount: { emailAddress: "x@y.z" },
    userID: "u",
    cachedUsageUtilization: { a: 1 },
    mcpServers: { s: {} },
    projects: { "/p": {} },
    opus45MigrationComplete: true,
    numStartups: 12,
  });
  assert.equal("oauthAccount" in f, false);
  assert.equal("userID" in f, false);
  assert.equal("cachedUsageUtilization" in f, false);
  assert.equal("numStartups" in f, false);
  assert.deepEqual(f.mcpServers, { s: {} });
  assert.deepEqual(f.projects, { "/p": {} });
  assert.equal(f.opus45MigrationComplete, true);
});

test("auSeuil", () => {
  const futur = new Date(Date.now() + 3600_000).toISOString();
  const passe = new Date(Date.now() - 3600_000).toISOString();
  const base: Quotas = { compte: "A", majLe: Date.now(), source: "direct" };
  assert.equal(auSeuil(undefined), undefined);
  assert.equal(auSeuil({ ...base, cinqHeures: { pct: 89, reset: futur } }), undefined);
  assert.equal(auSeuil({ ...base, cinqHeures: { pct: 90, reset: futur } })?.limite, "5 h");
  assert.equal(auSeuil({ ...base, cinqHeures: { pct: 95, reset: passe } }), undefined); // limite déjà remise à zéro
  assert.equal(auSeuil({ ...base, cinqHeures: { pct: 10, reset: futur }, semaine: { pct: 93 } })?.limite, "semaine");
  assert.equal(auSeuil({ ...base, cinqHeures: { pct: 80 } }, 75)?.limite, "5 h");
});

test("installer : liens créés, 2e passage idempotent, vrai fichier = conflit intact", () => {
  const home = maison();
  fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "a@b.c" }, mcpServers: { x: {} } }));
  const r1 = installer(LANCEUR, home);
  assert.ok(r1.crees.length > 40);
  assert.deepEqual(r1.conflits, []);
  const A = dossierCompte("A", home);
  assert.equal(fs.readlinkSync(path.join(A, "settings.json")), path.join(home, ".claude", "settings.json"));
  assert.ok(fs.lstatSync(path.join(A, "skills")).isSymbolicLink());
  const fiche = JSON.parse(fs.readFileSync(path.join(A, ".claude.json"), "utf8"));
  assert.equal("oauthAccount" in fiche, false);
  assert.deepEqual(fiche.mcpServers, { x: {} });
  assert.equal(infosCompte("A", home).connecte, false);
  assert.ok(fs.existsSync(path.join(home, ".claude", "comptes", "bin", "lanceur")));

  const r2 = installer(LANCEUR, home);
  assert.deepEqual(r2.crees, []);
  assert.deepEqual(r2.conflits, []);

  // Claude a créé un vrai dossier à la place d'un lien
  const skills = path.join(A, "skills");
  fs.unlinkSync(skills);
  fs.mkdirSync(skills);
  fs.writeFileSync(path.join(skills, "garde.txt"), "x");
  const r3 = installer(LANCEUR, home);
  assert.deepEqual(r3.conflits, [skills]);
  assert.equal(fs.lstatSync(skills).isDirectory(), true);
  assert.equal(fs.readFileSync(path.join(skills, "garde.txt"), "utf8"), "x");
});

test("registre : écriture, lecture, rejet de ../x", () => {
  const home = maison();
  const id = "123e4567-e89b-12d3-a456-426614174000";
  ecrireCompte(id, "B", home);
  assert.equal(lireCompte(id, home), "B");
  assert.equal(lireCompte("inconnu-0000-0000", home), undefined);
  assert.throws(() => ecrireCompte("../x", "A", home));
  assert.equal(lireCompte("../x", home), undefined);
  assert.equal(estNumeroConversation("../x"), false);
  assert.equal(estNumeroConversation(id), true);
  assert.deepEqual(fs.readdirSync(path.join(home, ".claude", "comptes", "registre")), [id]);
});

test("mémoire de projet : écriture atomique relue par la clé du lanceur", () => {
  const home = maison();
  const dossier = "/Users/jane/Desktop/dossier sans titre/été";
  assert.equal(lireCompteProjet(dossier, home), undefined);
  ecrireCompteProjet(dossier, "B", home);
  assert.equal(lireCompteProjet(dossier, home), "B");
  const f = path.join(home, ".claude", "comptes", "projets", cleProjetLanceur(dossier));
  assert.equal(fs.readFileSync(f, "utf8"), "B\n");
  assert.deepEqual(fs.readdirSync(path.dirname(f)), [cleProjetLanceur(dossier)]);
});

test("cheminPs : /bin/ps, sinon /usr/bin/ps, sinon « ps » cherché dans le PATH", () => {
  assert.equal(cheminPs(() => true), "/bin/ps");
  assert.equal(cheminPs((p) => p === "/usr/bin/ps"), "/usr/bin/ps");
  assert.equal(cheminPs(() => false), "ps");
});

test("conversationsVivantes : voit un processus de conversation (macOS comme Linux)", async () => {
  const id = "9a8b7c6d-1111-4222-8333-444455556666";
  // bash : « exec -a » donne au processus la ligne de commande d'un Claude en flux, sur les deux systèmes.
  const enfant = spawn("bash", ["-c", 'exec -a "claude-test stream-json --session-id=$1" sleep 20', "_", id], { stdio: "ignore" });
  try {
    let vues = new Map<string, number>();
    for (let i = 0; i < 40 && !vues.has(id); i++) {
      await new Promise((r) => setTimeout(r, 50));
      vues = await conversationsVivantes();
    }
    assert.equal(vues.get(id), enfant.pid);
  } finally {
    enfant.kill();
  }
});
