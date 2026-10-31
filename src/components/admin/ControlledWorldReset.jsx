import React, { useCallback, useEffect, useRef, useState } from "react";
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
  storage: "Limpando arquivos do universo",
  accounts: "Removendo acessos comuns confirmados",
  validating: "Verificando o novo mundo",
  validated: "Verificado — aguardando reabertura",
  failed: "Interrompido — manutenção preservada",
  completed: "Concluído e reaberto",
  cancelled: "Cancelado — universo liberado",
  paused: "Pausado — mundo em manutenção",
};
const phaseLabels = {
  ...labels,
  preserving: "Conferindo registros protegidos",
  backup_verification: "Verificando cópias e arquivos",
  profiles: "Reiniciando personagens",
  checking_relations: "Conferindo relacionamentos",
  final_validation: "Validação final",
};
const stepLabels = {
  pending: "Aguardando",
  running: "Em andamento",
  completed: "Concluída",
  failed: "Interrompida",
};
const call = async (name, args) => {
  const r = await supabase.rpc(name, args);
  if (r.error) throw new Error(r.error.message);
  return r.data;
};
export default function ControlledWorldReset() {
  const [audit, setAudit] = useState(null),
    [preview, setPreview] = useState(null),
    [job, setJob] = useState(null),
    [mode, setMode] = useState("universe"),
    [remove, setRemove] = useState(false),
    [backup, setBackup] = useState("yes"),
    [skipBackupOnResume, setSkipBackupOnResume] = useState(false),
    [progressError, setProgressError] = useState(""),
    [lastUpdated, setLastUpdated] = useState(null),
    [reason, setReason] = useState(""),
    [phrase, setPhrase] = useState(""),
    [accountPhrase, setAccountPhrase] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [report, setReport] = useState(null);
  const [controlAction, setControlAction] = useState(null);
  const [controlNotice, setControlNotice] = useState("");
  const refreshing = useRef(false);
  const mounted = useRef(true);
  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const { data, error } = await supabase
        .rpc("admin_get_controlled_reset")
        .abortSignal(AbortSignal.timeout(7000));
      if (error) throw error;
      if (mounted.current) {
        setJob(data);
        setProgressError("");
        setLastUpdated(new Date());
      }
    } catch (e) {
      console.error("Consulta de progresso do reset:", e);
      if (mounted.current)
        setProgressError(
          "Não foi possível atualizar o progresso agora. O último estado continua visível; a consulta será repetida automaticamente.",
        );
    } finally {
      refreshing.current = false;
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 6000);
    window.addEventListener("focus", refresh);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
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
        p_create_backup: backup === "yes",
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
  const requestControl = (action) =>
    run(async () => {
      await login();
      const response = await call("admin_request_reset_control", {
        p_request_id: job.id,
        p_action: action,
      });
      if (!response?.accepted)
        throw new Error("O comando não foi confirmado pelo servidor.");
      setControlAction(null);
      setControlNotice(
        action === "skip_backup"
          ? "Pedido aceito. O worker vai dispensar o backup ao terminar o ciclo atual e continuar o reset."
          : action === "cancel"
            ? "Cancelamento solicitado. Aguarde o worker concluir o ciclo atual e liberar o universo."
            : "Pausa solicitada. O mundo permanecerá em manutenção até a retomada.",
      );
      await refresh();
    });
  const active =
    job && !["draft", "expired", "completed", "cancelled"].includes(job.status);
  const steps = job?.steps || [],
    completed =
      job?.progress?.completed ??
      steps.filter((s) => s.status === "completed").length,
    total = job?.progress?.total ?? steps.length;
  return (
    <section
      className="space-y-4 rounded-xl border border-red-500/40 p-4"
      aria-label="Reset Geral controlado"
    >
      <h3 className="text-lg font-semibold">Reset Geral do universo</h3>
      <p className="text-sm text-muted-foreground">
        Reinicia personagens, cargos, patrimônio e histórias do RP. Identidades
        administrativas, doações reais, suporte e estruturas essenciais ficam
        protegidos. Escolha se deseja criar um backup antes de iniciar. O
        andamento e a validação ficam nesta mesma seção.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy || active} onClick={analyze}>
          Analisar Reset
        </Button>
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
            . Backup:{" "}
            {backup === "yes"
              ? "será criado e verificado antes da limpeza"
              : "dispensado; sem cópia para restaurar os dados removidos"}
            .
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
                <fieldset className="space-y-2 rounded-lg border p-3">
                  <legend className="px-1 text-sm font-medium">
                    Deseja fazer backup antes do reset?
                  </legend>
                  <label className="flex min-h-11 items-center gap-2">
                    <input
                      type="radio"
                      name="reset-backup"
                      value="yes"
                      checked={backup === "yes"}
                      onChange={() => setBackup("yes")}
                    />
                    Sim, criar e verificar uma cópia
                  </label>
                  <label className="flex min-h-11 items-center gap-2">
                    <input
                      type="radio"
                      name="reset-backup"
                      value="no"
                      checked={backup === "no"}
                      onChange={() => setBackup("no")}
                    />
                    Não, executar sem backup
                  </label>
                  {backup === "no" && (
                    <p className="text-sm text-amber-400">
                      Os dados removidos não terão cópia de recuperação desta
                      execução. A preservação dos Admins e a validação de
                      integridade continuam obrigatórias.
                    </p>
                  )}
                </fieldset>
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
            {backup === "yes"
              ? "Com backup: a limpeza só começa após verificar as cópias."
              : "Sem backup: os dados apagados por esta execução não poderão ser restaurados a partir dela."}
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
            Confirmar e iniciar reset
          </Button>
        </div>
      )}
      {job && job.started_at && (
        <div className="space-y-3 rounded-lg border p-3">
          <p role="status" className="font-semibold">
            {job.current_phase === "preserving" && job.status !== "failed"
              ? "Conferindo registros protegidos"
              : labels[job.status] || job.status}
          </p>
          <p className="break-all text-xs">Registro: {job.id}</p>
          <progress
            aria-label="Etapas concluídas"
            className="w-full"
            value={completed}
            max={Math.max(total, 1)}
          />
          <p>
            {completed} de {total} etapas verificadas.{" "}
            {total ? Math.floor((completed / total) * 100) : 0}% concluído.
          </p>
          <p className="text-sm">
            {steps.find((s) => s.status !== "completed")?.table_name ||
              phaseLabels[job.current_phase] ||
              job.current_phase}
          </p>
          {controlNotice && (
            <p role="status" className="text-sm text-amber-300">{controlNotice}</p>
          )}
          {active && !["paused", "validated", "failed"].includes(job.status) && (
            <div className="flex flex-wrap items-center gap-2">
              {["draining", "backing_up", "preserving", "backup_verification"].includes(job.current_phase) ? (
                <>
                  {job.create_backup !== false && (
                    <Button variant="outline" disabled={busy} onClick={() => setControlAction("skip_backup")}>
                      Dispensar backup e continuar
                    </Button>
                  )}
                  <Button variant="destructive" disabled={busy} onClick={() => setControlAction("cancel")}>
                    Cancelar reset
                  </Button>
                </>
              ) : (
                <Button variant="outline" disabled={busy} onClick={() => setControlAction("pause")}>
                  Pausar reset (manter manutenção)
                </Button>
              )}
            </div>
          )}
          {controlAction && active && !["paused", "validated", "failed"].includes(job.status) && (
            <div className="space-y-3 rounded-lg border border-amber-500/40 p-3">
              <p className="font-semibold">
                {controlAction === "skip_backup"
                  ? "Continuar sem backup?"
                  : controlAction === "cancel"
                    ? "Cancelar a execução antes da limpeza?"
                    : "Pausar a execução e manter a manutenção?"}
              </p>
              <p className="text-sm text-muted-foreground">
                {controlAction === "skip_backup"
                  ? "A limpeza será irreversível e o reset continuará sem uma cópia completa dos dados. A proteção dos Admins e a validação final permanecem obrigatórias."
                  : controlAction === "cancel"
                    ? "O cancelamento só será permitido se nenhuma etapa destrutiva tiver começado. Os dados do RP serão mantidos."
                    : "O reset será interrompido entre tarefas. Não será possível liberar o mundo até concluir o reset."}
              </p>
              <Label htmlFor="reset-control-password">Senha, se sua sessão administrativa precisar de reautenticação</Label>
              <Input
                id="reset-control-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" disabled={busy} onClick={() => setControlAction(null)}>
                  Voltar
                </Button>
                <Button
                  variant={controlAction === "cancel" ? "destructive" : "default"}
                  disabled={busy}
                  onClick={() => void requestControl(controlAction)}
                >
                  Confirmar {controlAction === "skip_backup" ? "e continuar sem backup" : controlAction === "cancel" ? "cancelamento" : "pausa"}
                </Button>
              </div>
            </div>
          )}
          {job.status === "failed" && job.last_error && (
            <p role="alert" className="text-red-400">
              {job.last_error.message}
            </p>
          )}
          <details>
            <summary>Etapas recentes e próximas etapas</summary>
            <div className="max-h-72 overflow-auto text-xs">
              {steps.map((s) => (
                <p className="break-all" key={s.id}>
                  {s.ordinal + 1}. {phaseLabels[s.phase] || s.phase}{" "}
                  {s.schema_name}.{s.table_name} ·{" "}
                  {stepLabels[s.status] || s.status} · {s.processed} registros ·{" "}
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
              copiados aguardando limpeza; {job.files.deleted} removidos{" "}
              {job.create_backup === false ? "sem backup" : "com cópia"};{" "}
              {job.files.retained} preservados.
            </p>
          )}
          <p className="text-xs">
            Backup:{" "}
            {job.create_backup === false
              ? "dispensado nesta execução"
              : job.backup?.state === "verified"
                ? "verificado"
                : "em preparação"}
            .
          </p>
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
              {job.status === "failed" &&
                job.create_backup !== false &&
                [
                  "draining",
                  "backing_up",
                  "preserving",
                  "backup_verification",
                ].includes(job.current_phase) && (
                  <label className="flex min-h-11 items-start gap-2 text-sm">
                    <Checkbox
                      checked={skipBackupOnResume}
                      onCheckedChange={(value) =>
                        setSkipBackupOnResume(value === true)
                      }
                    />
                    <span>
                      Dispensar backup ao retomar. As cópias parciais já geradas
                      serão mantidas; esta execução não terá um backup completo
                      para recuperação.
                    </span>
                  </label>
                )}
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
            {["failed", "paused"].includes(job.status) && (
              <Button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await login();
                    if (skipBackupOnResume && job.create_backup !== false)
                      await call("admin_skip_reset_backup", {
                        p_request_id: job.id,
                      });
                    await call("admin_resume_controlled_reset", {
                      p_request_id: job.id,
                    });
                    await refresh();
                  })
                }
              >
                {job.status === "paused" ? "Retomar reset" : "Retomar do checkpoint"}
              </Button>
            )}
            {["validated", "completed"].includes(job.status) && (
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
      <div className="flex flex-wrap items-center gap-2">
        {!job?.started_at && (
          <Button variant="outline" onClick={() => void refresh()}>
            Consultar progresso
          </Button>
        )}
        {lastUpdated && (
          <span className="text-xs text-muted-foreground">
            Atualizado às {lastUpdated.toLocaleTimeString("pt-BR")}. Atualização
            automática.
          </span>
        )}
      </div>
      {progressError && (
        <p role="alert" className="text-sm text-amber-400">
          {progressError}
        </p>
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
