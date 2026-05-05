import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CheckCircle2, CreditCard, Landmark, Loader2, Percent, Save, XCircle } from 'lucide-react';
import { formatCurrency, parseCurrency } from '@/lib/utils';
import {
  annualPercentToMonthlyPercent,
  DEFAULT_ECONOMIC_POLICY,
  ECONOMIC_POLICY_SETTINGS_KEY,
  normalizeBankPolicyForEconomicPolicy,
  normalizeEconomicPolicy,
} from '@/lib/economicPolicy';

export const NATIONAL_BANK_PRESIDENT_ROLE = 'Presidente do Banco Nacional';
export const BANK_POLICY_SETTINGS_KEY = 'bank_policy';

export const DEFAULT_BANK_POLICY = {
  loan_interest_rate: 2.5,
  credit_card_revolving_rate: 8.9,
  government_debt_interest_rate: 1.75,
  credit_card_default_limit: 5000,
};

export const canManageNationalBank = (user) => {
  const rolePool = Array.isArray(user?.effective_roles)
    ? user.effective_roles
    : [user?.role].filter(Boolean);

  return ['Admin', NATIONAL_BANK_PRESIDENT_ROLE].some((role) => rolePool.includes(role));
};

const normalizePolicy = (value = {}) => ({
  ...DEFAULT_BANK_POLICY,
  ...(value && typeof value === 'object' ? value : {}),
});

const isPendingStatus = (status = '') => ['Pendente', 'pending'].includes(status);

const getStatusBadgeClass = (status = '') => {
  if (['Aprovado', 'approved'].includes(status)) {
    return 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300';
  }

  if (['Rejeitado', 'rejected'].includes(status)) {
    return 'border-red-500/30 bg-red-500/15 text-red-300';
  }

  return 'border-amber-500/30 bg-amber-500/15 text-amber-300';
};

const BankManagementPanel = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [processingId, setProcessingId] = useState(null);
  const [policy, setPolicy] = useState(DEFAULT_BANK_POLICY);
  const [economicPolicy, setEconomicPolicy] = useState(DEFAULT_ECONOMIC_POLICY);
  const [creditApplications, setCreditApplications] = useState([]);
  const [loanApplications, setLoanApplications] = useState([]);
  const [profilesById, setProfilesById] = useState({});
  const [cardLimits, setCardLimits] = useState({});
  const [loanInstallments, setLoanInstallments] = useState({});
  const [feedbackById, setFeedbackById] = useState({});

  const canManage = canManageNationalBank(user);

  const fetchProfiles = useCallback(async (userIds = []) => {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) {
      setProfilesById({});
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, username')
      .in('id', ids);

    if (error) {
      throw error;
    }

    setProfilesById(
      (data || []).reduce((accumulator, profile) => {
        accumulator[profile.id] = profile;
        return accumulator;
      }, {})
    );
  }, []);

  const fetchData = useCallback(async () => {
    if (!canManage) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [policyResponse, economicPolicyResponse, cardsResponse, loansResponse] = await Promise.all([
        supabase.from('system_settings').select('value').eq('key', BANK_POLICY_SETTINGS_KEY).maybeSingle(),
        supabase.from('system_settings').select('value').eq('key', ECONOMIC_POLICY_SETTINGS_KEY).maybeSingle(),
        supabase.from('credit_card_applications').select('*').order('created_at', { ascending: false }).limit(50),
        supabase.from('loan_applications').select('*').order('created_at', { ascending: false }).limit(50),
      ]);

      if (policyResponse.error) {
        throw policyResponse.error;
      }

      if (economicPolicyResponse.error) {
        throw economicPolicyResponse.error;
      }

      if (cardsResponse.error) {
        throw cardsResponse.error;
      }

      if (loansResponse.error) {
        throw loansResponse.error;
      }

      const normalizedEconomicPolicy = normalizeEconomicPolicy(economicPolicyResponse.data?.value);
      const normalizedPolicy = normalizeBankPolicyForEconomicPolicy(
        policyResponse.data?.value,
        normalizedEconomicPolicy,
        DEFAULT_BANK_POLICY
      );
      const cardRows = cardsResponse.data || [];
      const loanRows = loansResponse.data || [];

      setEconomicPolicy(normalizedEconomicPolicy);
      setPolicy(normalizedPolicy);
      setCreditApplications(cardRows);
      setLoanApplications(loanRows);
      setCardLimits((current) => ({
        ...cardRows.reduce((accumulator, application) => {
          accumulator[application.id] = formatCurrency(
            Number(application.requested_limit || normalizedPolicy.credit_card_default_limit || 0),
            true
          );
          return accumulator;
        }, {}),
        ...current,
      }));
      setLoanInstallments((current) => ({
        ...loanRows.reduce((accumulator, application) => {
          accumulator[application.id] = String(application.installments || 12);
          return accumulator;
        }, {}),
        ...current,
      }));

      await fetchProfiles([
        ...cardRows.map((application) => application.user_id),
        ...loanRows.map((application) => application.user_id),
      ]);
    } catch (error) {
      toast({ title: 'Erro ao carregar gestão bancária', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [canManage, fetchProfiles, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const pendingCreditApplications = useMemo(
    () => creditApplications.filter((application) => isPendingStatus(application.status)),
    [creditApplications]
  );
  const pendingLoanApplications = useMemo(
    () => loanApplications.filter((application) => isPendingStatus(application.status)),
    [loanApplications]
  );

  const updatePolicyRate = (field, value) => {
    const nextValue = Number(value);
    setPolicy((current) => ({ ...current, [field]: Number.isFinite(nextValue) ? nextValue : 0 }));
  };

  const handleSavePolicy = async () => {
    setSavingPolicy(true);
    const nextPolicy = normalizeBankPolicyForEconomicPolicy(policy, economicPolicy, DEFAULT_BANK_POLICY);
    const { error } = await supabase
      .from('system_settings')
      .upsert(
        {
          key: BANK_POLICY_SETTINGS_KEY,
          value: nextPolicy,
          description: 'Política de juros e crédito do Banco Nacional.',
        },
        { onConflict: 'key' }
      );

    if (error) {
      toast({ title: 'Erro ao salvar taxas', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Taxas do Banco Nacional atualizadas' });
      fetchData();
    }
    setSavingPolicy(false);
  };

  const handleCardDecision = async (application, action) => {
    setProcessingId(application.id);
    try {
      const isApproval = action === 'approve';
      const rpcName = isApproval ? 'approve_credit_card_application' : 'reject_credit_card_application';
      const params = isApproval
        ? { p_application_id: application.id, p_card_limit: parseCurrency(cardLimits[application.id]) }
        : { p_application_id: application.id, p_feedback: feedbackById[application.id] || null };
      const { data, error } = await supabase.rpc(rpcName, params);

      if (error || data?.success === false) {
        throw new Error(data?.message || error?.message || 'Não foi possível revisar a solicitação.');
      }

      toast({ title: isApproval ? 'Cartão aprovado' : 'Cartão rejeitado', description: data?.message });
      fetchData();
    } catch (error) {
      toast({ title: 'Erro na revisão do cartão', description: error.message, variant: 'destructive' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleLoanDecision = async (application, action) => {
    setProcessingId(application.id);
    try {
      const isApproval = action === 'approve';
      const rpcName = isApproval ? 'approve_loan_application' : 'reject_loan_application';
      const params = isApproval
        ? {
            p_application_id: application.id,
            p_installments: Number(loanInstallments[application.id] || 12),
            p_feedback: feedbackById[application.id] || null,
          }
        : { p_application_id: application.id, p_feedback: feedbackById[application.id] || null };
      const { data, error } = await supabase.rpc(rpcName, params);

      if (error || data?.success === false) {
        throw new Error(data?.message || error?.message || 'Não foi possível revisar o empréstimo.');
      }

      toast({ title: isApproval ? 'Empréstimo aprovado' : 'Empréstimo rejeitado', description: data?.message });
      fetchData();
    } catch (error) {
      toast({ title: 'Erro na revisão do empréstimo', description: error.message, variant: 'destructive' });
    } finally {
      setProcessingId(null);
    }
  };

  const getProfileName = (userId) => profilesById[userId]?.full_name || profilesById[userId]?.username || 'Cidadão';
  const selicMonthlyRate = annualPercentToMonthlyPercent(economicPolicy.selic_rate);

  if (!canManage) {
    return (
      <Card className="glass-effect">
        <CardHeader>
          <CardTitle>Gestão do Banco Nacional</CardTitle>
          <CardDescription>Esta área é reservada a administradores e ao Presidente do Banco Nacional.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (loading) {
    return <div className="flex justify-center py-10"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="space-y-6">
      <Card className="glass-effect">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Landmark className="h-5 w-5 text-emerald-400" /> Gestão do Banco Nacional</CardTitle>
          <CardDescription>
            Aprove crédito, revise empréstimos e defina a política de juros aplicada pelo banco estatal.
            Selic vigente: {Number(economicPolicy.selic_rate || 0).toFixed(2)}% a.a. ({selicMonthlyRate.toFixed(2)}% a.m.).
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="space-y-2">
            <Label>Juros de empréstimos (% a.m.)</Label>
            <div className="flex items-center gap-2">
              <Input type="number" min="0" step="0.01" value={policy.loan_interest_rate} onChange={(event) => updatePolicyRate('loan_interest_rate', event.target.value)} />
              <Percent className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">Spread atual: {Number(policy.loan_interest_spread || 0).toFixed(2)} p.p. sobre a Selic mensal.</p>
          </div>
          <div className="space-y-2">
            <Label>Rotativo do cartão (% a.m.)</Label>
            <div className="flex items-center gap-2">
              <Input type="number" min="0" step="0.01" value={policy.credit_card_revolving_rate} onChange={(event) => updatePolicyRate('credit_card_revolving_rate', event.target.value)} />
              <Percent className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">Spread atual: {Number(policy.credit_card_revolving_spread || 0).toFixed(2)} p.p. sobre a Selic mensal.</p>
          </div>
          <div className="space-y-2">
            <Label>Dívida governamental (% a.m.)</Label>
            <div className="flex items-center gap-2">
              <Input type="number" min="0" step="0.01" value={policy.government_debt_interest_rate} onChange={(event) => updatePolicyRate('government_debt_interest_rate', event.target.value)} />
              <Percent className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-xs text-muted-foreground">Spread atual: {Number(policy.government_debt_interest_spread || 0).toFixed(2)} p.p. sobre a Selic mensal.</p>
          </div>
          <div className="space-y-2">
            <Label>Limite padrão de cartão</Label>
            <Input value={formatCurrency(policy.credit_card_default_limit || 0, true)} onChange={(event) => setPolicy((current) => ({ ...current, credit_card_default_limit: parseCurrency(event.target.value) }))} />
          </div>
          <div className="md:col-span-2 xl:col-span-4">
            <Button onClick={handleSavePolicy} disabled={savingPolicy}>
              {savingPolicy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar Política de Juros
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-effect">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-sky-400" /> Solicitações de Cartão</CardTitle>
          <CardDescription>{pendingCreditApplications.length} solicitação(ões) pendente(s).</CardDescription>
        </CardHeader>
        <CardContent>
          {creditApplications.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cidadão</TableHead>
                  <TableHead>Bandeira</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Limite</TableHead>
                  <TableHead>Feedback</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {creditApplications.map((application) => {
                  const pending = isPendingStatus(application.status);
                  return (
                    <TableRow key={application.id}>
                      <TableCell>{getProfileName(application.user_id)}</TableCell>
                      <TableCell className="capitalize">{application.brand}</TableCell>
                      <TableCell><Badge className={`border ${getStatusBadgeClass(application.status)}`}>{application.status}</Badge></TableCell>
                      <TableCell>
                        {pending ? (
                          <Input className="h-8 w-32" value={cardLimits[application.id] || ''} onChange={(event) => setCardLimits((current) => ({ ...current, [application.id]: formatCurrency(event.target.value, true) }))} />
                        ) : (
                          formatCurrency(application.approved_limit || application.requested_limit || 0)
                        )}
                      </TableCell>
                      <TableCell>
                        {pending ? (
                          <Textarea className="min-h-8 w-48" value={feedbackById[application.id] || ''} onChange={(event) => setFeedbackById((current) => ({ ...current, [application.id]: event.target.value }))} placeholder="Motivo opcional" />
                        ) : (
                          application.feedback || '-'
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {pending ? (
                          <div className="flex justify-end gap-2">
                            <Button size="sm" onClick={() => handleCardDecision(application, 'approve')} disabled={processingId === application.id}>
                              {processingId === application.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
                              Aprovar
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => handleCardDecision(application, 'reject')} disabled={processingId === application.id}>
                              <XCircle className="mr-1 h-4 w-4" />
                              Rejeitar
                            </Button>
                          </div>
                        ) : '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="py-6 text-center text-muted-foreground">Nenhuma solicitação de cartão encontrada.</p>
          )}
        </CardContent>
      </Card>

      <Card className="glass-effect">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Landmark className="h-5 w-5 text-amber-400" /> Solicitações de Empréstimo</CardTitle>
          <CardDescription>{pendingLoanApplications.length} solicitação(ões) pendente(s). Juros atuais: {Number(policy.loan_interest_rate || 0).toFixed(2)}% a.m.</CardDescription>
        </CardHeader>
        <CardContent>
          {loanApplications.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cidadão</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Parcelas</TableHead>
                  <TableHead>Total estimado</TableHead>
                  <TableHead>Feedback</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loanApplications.map((application) => {
                  const pending = isPendingStatus(application.status);
                  const rate = Number(application.interest_rate ?? policy.loan_interest_rate ?? 0);
                  const totalDue = Number(application.total_due || application.amount * (1 + rate / 100));
                  return (
                    <TableRow key={application.id}>
                      <TableCell>{getProfileName(application.user_id)}</TableCell>
                      <TableCell>{formatCurrency(application.amount || 0)}</TableCell>
                      <TableCell><Badge className={`border ${getStatusBadgeClass(application.status)}`}>{application.status}</Badge></TableCell>
                      <TableCell>
                        {pending ? (
                          <Input type="number" min="1" className="h-8 w-20" value={loanInstallments[application.id] || '12'} onChange={(event) => setLoanInstallments((current) => ({ ...current, [application.id]: event.target.value }))} />
                        ) : (
                          application.installments || '-'
                        )}
                      </TableCell>
                      <TableCell>{formatCurrency(totalDue)}</TableCell>
                      <TableCell>
                        {pending ? (
                          <Textarea className="min-h-8 w-48" value={feedbackById[application.id] || ''} onChange={(event) => setFeedbackById((current) => ({ ...current, [application.id]: event.target.value }))} placeholder="Motivo opcional" />
                        ) : (
                          application.admin_feedback || application.feedback || '-'
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {pending ? (
                          <div className="flex justify-end gap-2">
                            <Button size="sm" onClick={() => handleLoanDecision(application, 'approve')} disabled={processingId === application.id}>
                              {processingId === application.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}
                              Aprovar
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => handleLoanDecision(application, 'reject')} disabled={processingId === application.id}>
                              <XCircle className="mr-1 h-4 w-4" />
                              Rejeitar
                            </Button>
                          </div>
                        ) : '-'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="py-6 text-center text-muted-foreground">Nenhuma solicitação de empréstimo encontrada.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default BankManagementPanel;
