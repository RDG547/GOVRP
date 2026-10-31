import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { prepareAdminReset } from "@/lib/adminReset";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";

const labels = {
  draft: "Prévia preparada",
  draining: "Aguardando operações em andamento",
  backing_up: "Criando e verificando backup",
  detaching: "Preparando relacionamentos",
  clearing: "Limpando o universo",
  initializing: "Inicializando catálogos",
  storage: "Limpando arquivos já copiados",
  accounts: "Removendo acessos comuns confirmados",
  validating: "Verificando o novo mundo",
  validated: "Verificado — aguardando reabertura",
  failed: "Interrompido — manutenção preservada",
  completed: "Concluído e reaberto",
};
const call = async (name, args) => {
  const r = await supabase.rpc(name, args);
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
const download = (value, name) => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export default function ControlledWorldReset() {
  const [audit, setAudit] = useState(null),
    [preview, setPreview] = useState(null),
    [job, setJob] = useState(null),
    [mode, setMode] = useState("universe"),
    [remove, setRemove] = useState(false),
    [reason, setReason] = useState(""),
    [phrase, setPhrase] = useState(""),
    [accountPhrase, setAccountPhrase] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [report, setReport] = useState(null);
  const refresh = useCallback(async () => {
    try {
      setJob(await call("admin_get_controlled_reset"));
    } catch (e) {
      setError(
        `Não foi possível consultar o acompanhamento. A execução continua no servidor. ${e.message}`,
      );
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, [refresh]);
  const run = async (work) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const analyze = () =>
    run(async () => {
      setPreview(null);
      setAudit(await call("admin_analyze_rp_reset"));
    });
  const prepare = () =>
    run(async () => {
      setPreview(await prepareAdminReset({ scope: "full_rp", reason }));
      setPhrase("");
    });
  const login = async () => {
    if (password) {
      const { data } = await supabase.auth.getSession();
      const result = await supabase.auth.signInWithPassword({
        email: data.session.user.email,
        password,
      });
      setPassword("");
      if (result.error)
        throw new Error(
          "Não foi possível confirmar seu login. Confira a senha.",
        );
    }
  };
  const start = () =>
    run(async () => {
      await login();
      await call("admin_configure_reset_request", {
        p_request_id: preview.request_id,
        p_mode: mode,
        p_remove_common_accounts: remove && mode === "launch",
      });
      const accepted = await call("admin_start_controlled_reset", {
        p_request_id: preview.request_id,
        p_confirmation: phrase,
        p_account_confirmation: accountPhrase,
      });
      if (!accepted.accepted)
        throw new Error(
          "O início não foi confirmado. Consulte o acompanhamento.",
        );
      setPreview(null);
      setPhrase("");
      await refresh();
    });
  const active =
    job && !["draft", "expired", "completed", "cancelled"].includes(job.status);
  const steps = job?.steps || [],
    completed = steps.filter((s) => s.status === "completed").length;
  return (
    <section
      className="space-y-4 rounded-xl border border-red-500/40 p-4"
      aria-label="Reset Geral controlado"
    >
      <h3 className="text-lg font-semibold">Reset Geral do universo</h3>
      <p className="text-sm text-muted-foreground">
        Reinicia personagens, cargos, patrimônio e histórias do RP. Identidades
        administrativas, doações reais, suporte e estruturas essenciais ficam
        protegidos. O backup é criado e verificado sob manutenção antes da
        limpeza.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy || active} onClick={analyze}>
          Analisar Reset
        </Button>
        {audit && (
          <Button
            variant="outline"
            onClick={() => download(audit, "govrp-diagnostico-reset.json")}
          >
            Exportar diagnóstico e catálogo
          </Button>
        )}
      </div>
      {audit && (
        <div className="space-y-3 text-sm">
          <p>
            {audit.table_count} tabelas · {audit.module_count} módulos · cerca
            de {Number(audit.estimated_records).toLocaleString("pt-BR")}{" "}
            registros de RP (estimativa do PostgreSQL) · {audit.jobs.length}{" "}
            automações · {audit.auth_accounts} contas.
          </p>
          <p>
            {audit.admins.length} concessões administrativas serão preservadas,
            com conferência de UUID antes e depois.
          </p>
          <p className="text-xs">
            {Math.max(0, audit.auth_accounts - audit.admins.length)} contas
            comuns serão{" "}
            {mode === "launch" && remove
              ? "encerradas após a confirmação extra"
              : "preservadas"}
            . Backup físico: será criado e conferido antes da limpeza.
          </p>
          <details>
            <summary>Arquivos analisados</summary>
            {audit.storage.map((bucket) => (
              <p className="text-xs break-all" key={bucket.bucket}>
                {bucket.bucket}: {bucket.objects} arquivo(s) ·{" "}
                {bucket.bucket === "support-attachments"
                  ? "preservação de suporte"
                  : "classificação por referências e finalidade"}
              </p>
            ))}
          </details>
          <details>
            <summary>Administradores protegidos</summary>
            {audit.admins.map((a) => (
              <p className="break-all text-xs" key={a.id}>
                {a.id} —{" "}
                {a.auth_valid && a.profile_valid
                  ? "Identidade válida"
                  : "Regularização necessária"}
              </p>
            ))}
          </details>
          <details>
            <summary>Tabelas, módulos e política de preservação</summary>
            <div className="max-h-72 overflow-auto">
              {audit.tables.map((t) => (
                <p className="break-all text-xs" key={`${t.schema}.${t.table}`}>
                  {t.schema}.{t.table} · {t.classification} · {t.strategy} ·{" "}
                  {t.module} · ≈ {t.estimated_rows}
                </p>
              ))}
            </div>
          </details>
          <p className="text-xs">
            A: dados do RP. B: estruturas e estado inicial. C: autenticação e
            administração. D: registros reais e protegidos. O tempo depende do
            volume e dos arquivos; o painel mostrará etapas, lotes e duração
            reais.
          </p>
          {audit.blocked ? (
            <p role="alert" className="text-red-400">
              Reset bloqueado: há tabelas ou arquivos sem classificação.{" "}
              {JSON.stringify(audit.unknown_tables)}{" "}
              {JSON.stringify(audit.unknown_buckets)}
            </p>
          ) : (
            !active && (
              <div className="space-y-3">
                <Label htmlFor="world-reset-mode">Modo</Label>
                <select
                  id="world-reset-mode"
                  value={mode}
                  onChange={(e) => {
                    setMode(e.target.value);
                    setRemove(false);
                    setPreview(null);
                  }}
                  className="block w-full rounded-md border bg-background p-2"
                >
                  <option value="universe">
                    Reset do Universo — preservar logins comuns
                  </option>
                  <option value="launch">Reset de Lançamento</option>
                </select>
                {mode === "launch" && (
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={remove}
                      onCheckedChange={(v) => setRemove(v === true)}
                    />
                    Remover também o acesso das contas comuns. Admins
                    permanecem.
                  </label>
                )}
                <Label htmlFor="world-reset-reason">Motivo</Label>
                <Input
                  id="world-reset-reason"
                  value={reason}
                  maxLength={500}
                  onChange={(e) => setReason(e.target.value)}
                />
                <Button disabled={busy} onClick={prepare}>
                  Preparar prévia e referências iniciais
                </Button>
              </div>
            )
          )}
        </div>
      )}
      {preview && !active && (
        <div className="space-y-3 rounded-lg border border-amber-500/40 p-3">
          <p>
            Confirmação válida por 15 minutos. Durante a execução o mundo ficará
            fechado; fechar esta página não interrompe o trabalho. A reabertura
            exige validação e ação administrativa.
          </p>
          <p className="text-sm">
            O recibo será disponibilizado após a cópia paginada dos dados e
            arquivos. Ele identifica as cópias mantidas no servidor; não
            representa sozinho um backup completo baixado.
          </p>
          <Label htmlFor="world-reset-password">
            Confirmar senha (se o último login tiver mais de 30 minutos)
          </Label>
          <Input
            type="password"
            id="world-reset-password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Label htmlFor="world-reset-phrase">Digite RESETAR GOVRP</Label>
          <Input
            id="world-reset-phrase"
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            autoComplete="off"
          />
          {remove && mode === "launch" && (
            <>
              <Label htmlFor="world-account-phrase">
                Digite EXCLUIR CONTAS COMUNS
              </Label>
              <Input
                id="world-account-phrase"
                value={accountPhrase}
                onChange={(e) => setAccountPhrase(e.target.value)}
                autoComplete="off"
              />
            </>
          )}
          <Button
            variant="destructive"
            disabled={
              busy ||
              phrase !== "RESETAR GOVRP" ||
              (remove && accountPhrase !== "EXCLUIR CONTAS COMUNS")
            }
            onClick={start}
          >
            Confirmar manutenção e iniciar backup
          </Button>
        </div>
      )}
      {job && job.started_at && (
        <div className="space-y-3 rounded-lg border p-3">
          <p role="status" className="font-semibold">
            {labels[job.status] || job.status}
          </p>
          <p className="break-all text-xs">Registro: {job.id}</p>
          <progress
            aria-label="Etapas concluídas"
            className="w-full"
            value={completed}
            max={Math.max(steps.length, 1)}
          />
          <p>
            {completed} de {steps.length} etapas verificadas.
          </p>
          <p className="text-sm">
            {steps.find((s) => s.status !== "completed")?.table_name ||
              job.current_phase}
          </p>
          {job.last_error && (
            <p role="alert" className="text-red-400">
              {job.last_error.message}
            </p>
          )}
          <details>
            <summary>Progresso por etapa e tempo</summary>
            <div className="max-h-72 overflow-auto text-xs">
              {steps.map((s) => (
                <p className="break-all" key={s.id}>
                  {s.ordinal + 1}. {s.phase} {s.schema_name}.{s.table_name} ·{" "}
                  {s.status} · {s.processed} registros ·{" "}
                  {(s.started_at
                    ? (Date.parse(s.completed_at || new Date().toISOString()) -
                        Date.parse(s.started_at)) /
                      1000
                    : 0
                  ).toFixed(2)}{" "}
                  s
                </p>
              ))}
            </div>
          </details>
          {job.files && (
            <p className="text-xs">
              Arquivos: {job.files.total} analisados; {job.files.archived}{" "}
              copiados aguardando limpeza; {job.files.deleted} removidos com
              cópia; {job.files.retained} preservados.
            </p>
          )}
          {job.backup && (
            <p className="break-all text-xs">
              Backup: {job.backup.state} · {job.backup.chunks} blocos ·{" "}
              {job.backup.records} registros · SHA-256 {job.backup.digest}
            </p>
          )}
          {["failed", "validated"].includes(job.status) && (
            <div className="space-y-2">
              <Label htmlFor="resume-reset-password">
                Senha para reconfirmar login, se necessário
              </Label>
              <Input
                id="resume-reset-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-xs">
                Se usa login social, entre novamente em outra aba antes de
                continuar.
              </p>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void refresh()}
            >
              Consultar progresso
            </Button>
            {job.files && (
              <p className="text-xs">
                Arquivos: {job.files.total} analisados; {job.files.archived}{" "}
                copiados aguardando limpeza; {job.files.deleted} removidos com
                cópia; {job.files.retained} preservados.
              </p>
            )}
            {job.backup && (
              <Button
                variant="outline"
                onClick={() =>
                  run(async () =>
                    download(
                      await call("admin_backup_rp_reset", {
                        p_request_id: job.id,
                      }),
                      "govrp-recibo-backup.json",
                    ),
                  )
                }
              >
                Exportar recibo e manifesto
              </Button>
            )}
            {job.status === "failed" && (
              <Button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await login();
                    await call("admin_resume_controlled_reset", {
                      p_request_id: job.id,
                    });
                    await refresh();
                  })
                }
              >
                Retomar do checkpoint
              </Button>
            )}
            {["validated", "completed", "failed"].includes(job.status) && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  run(async () =>
                    setReport(
                      await call("admin_validate_controlled_reset", {
                        p_request_id: job.id,
                      }),
                    ),
                  )
                }
              >
                Verificar integridade
              </Button>
            )}
            {job.status === "validated" && (
              <Button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await login();
                    setReport(
                      await call("admin_reopen_reset_world", {
                        p_request_id: job.id,
                      }),
                    );
                    await refresh();
                  })
                }
              >
                Reabrir mundo verificado
              </Button>
            )}
          </div>
          {report && (
            <p role="status" className="text-sm">
              {report.valid
                ? "Verificação aprovada."
                : report.issues?.join(" ")}{" "}
              {report.preserved_admins} administradores preservados;{" "}
              {report.orphans?.length} referências órfãs.
            </p>
          )}
        </div>
      )}
      {busy && <p role="status">Processando esta ação…</p>}
      {error && (
        <p role="alert" className="break-words text-sm text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}
