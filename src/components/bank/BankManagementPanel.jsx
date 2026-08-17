import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ArrowRightLeft, CheckCircle2, ChevronLeft, ChevronRight, CreditCard, Landmark, Loader2, Percent, Save, WalletCards, XCircle } from 'lucide-react';
import { formatAccount, formatCurrency, parseCurrency } from '@/lib/utils';
import {
  annualPercentToMonthlyPercent,
  DEFAULT_ECONOMIC_POLICY,
  ECONOMIC_POLICY_SETTINGS_KEY,
  normalizeBankPolicyForEconomicPolicy,
  normalizeEconomicPolicy,
} from '@/lib/economicPolicy';

export const NATIONAL_BANK_PRESIDENT_ROLE = 'Presidente do Banco Nacional';
export const BANK_POLICY_SETTINGS_KEY = 'bank_policy';
export const CREDIT_CARD_BRANDS = [
  { value: 'visa', label: 'Visa' },
  { value: 'mastercard', label: 'Mastercard' },
];
const REQUESTS_PAGE_SIZE = 10;

const DEFAULT_CREDIT_CARD_BRAND_LIMITS = {
  visa: 5000,
  mastercard: 5000,
};

export const DEFAULT_BANK_POLICY = {
  loan_interest_rate: 2.5,
  credit_card_revolving_rate: 8.9,
  government_debt_interest_rate: 1.75,
  credit_card_default_limit: 5000,
  credit_card_brand_limits: DEFAULT_CREDIT_CARD_BRAND_LIMITS,
  exchange_fee_free: true,
  exchange_fee_type: 'percentage',
  exchange_fee_rate: 0,
  exchange_fee_fixed_amount: 0,
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

const toSafeNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : fallback;
};

const normalizeCardBrand = (brand = 'visa') => {
  const normalized = `${brand || ''}`.trim().toLowerCase();

  if (normalized.includes('master')) {
    return 'mastercard';
  }

  return 'visa';
};

const getBrandLabel = (brand) =>
  CREDIT_CARD_BRANDS.find((item) => item.value === normalizeCardBrand(brand))?.label || 'Visa';

export const getExchangeFeeMode = (policy = DEFAULT_BANK_POLICY) => {
  if (policy.exchange_fee_free) {
    return 'free';
  }

  return policy.exchange_fee_type === 'fixed' ? 'fixed' : 'percentage';
};

const getProfileInitials = (profile = {}) => {
  const source = profile.full_name || profile.username || 'Cidadão';
  const initials = source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();

  return initials || 'C';
};

const CardBrandIcon = ({ brand }) => {
  const normalizedBrand = normalizeCardBrand(brand);

  if (normalizedBrand === 'mastercard') {
    return (
      <span className="relative inline-flex h-7 w-10 shrink-0 items-center justify-center rounded-md border border-white/10 bg-slate-950/70" title="Mastercard">
        <span className="absolute left-2 h-4 w-4 rounded-full bg-red-500/90" />
        <span className="absolute right-2 h-4 w-4 rounded-full bg-amber-400/90" />
        <span className="relative text-[0.48rem] font-black tracking-tight text-white">MC</span>
      </span>
    );
  }

  return (
    <span className="inline-flex h-7 w-10 shrink-0 items-center justify-center rounded-md border border-blue-300/30 bg-blue-950/80 text-[0.55rem] font-black italic tracking-tight text-blue-100" title="Visa">
      VISA
    </span>
  );
};

export const normalizeBankPolicy = (value = {}) => {
  const basePolicy = normalizePolicy(value);
  const defaultLimit = Math.max(0, toSafeNumber(basePolicy.credit_card_default_limit, DEFAULT_BANK_POLICY.credit_card_default_limit));
  const rawBrandLimits =
    basePolicy.credit_card_brand_limits && typeof basePolicy.credit_card_brand_limits === 'object'
      ? basePolicy.credit_card_brand_limits
      : {};
  const rawExchangeFeeType =
    basePolicy.exchange_fee_type === 'fixed' || basePolicy.exchange_fee_type === 'percentage'
      ? basePolicy.exchange_fee_type
      : toSafeNumber(basePolicy.exchange_fee_fixed_amount, 0) > 0
        ? 'fixed'
        : 'percentage';
  const exchangeFeeRate = Math.min(100, Math.max(0, toSafeNumber(basePolicy.exchange_fee_rate, 0)));
  const exchangeFeeFixedAmount = Math.max(0, toSafeNumber(basePolicy.exchange_fee_fixed_amount, 0));
  const exchangeFeeFree =
    basePolicy.exchange_fee_free === true ||
    (basePolicy.exchange_fee_free !== false &&
      (rawExchangeFeeType === 'fixed' ? exchangeFeeFixedAmount <= 0 : exchangeFeeRate <= 0));

  return {
    ...basePolicy,
    credit_card_default_limit: defaultLimit,
    credit_card_brand_limits: CREDIT_CARD_BRANDS.reduce((accumulator, brand) => {
      accumulator[brand.value] = Math.max(
        0,
        toSafeNumber(rawBrandLimits[brand.value], defaultLimit || DEFAULT_CREDIT_CARD_BRAND_LIMITS[brand.value])
      );
      return accumulator;
    }, {}),
    exchange_fee_type: rawExchangeFeeType,
    exchange_fee_rate: exchangeFeeFree ? 0 : exchangeFeeRate,
    exchange_fee_fixed_amount: exchangeFeeFree ? 0 : exchangeFeeFixedAmount,
    exchange_fee_free: exchangeFeeFree,
  };
};

export const getCardBrandDefaultLimit = (policy = DEFAULT_BANK_POLICY, brand = 'visa') => {
  const normalizedPolicy = normalizeBankPolicy(policy);
  const normalizedBrand = normalizeCardBrand(brand);

  return (
    normalizedPolicy.credit_card_brand_limits?.[normalizedBrand] ||
    normalizedPolicy.credit_card_default_limit ||
    DEFAULT_CREDIT_CARD_BRAND_LIMITS[normalizedBrand] ||
    DEFAULT_BANK_POLICY.credit_card_default_limit
  );
};

const RATE_TO_SPREAD_FIELD = {
  loan_interest_rate: 'loan_interest_spread',
  credit_card_revolving_rate: 'credit_card_revolving_spread',
  government_debt_interest_rate: 'government_debt_interest_spread',
};

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

const CardLimitControl = ({ card, brand, draft, onDraftChange, onSave, saving, policy }) => {
  const displayBrand = card?.brand || brand;

  if (!card) {
    return (
      <div className="rounded-lg border border-dashed border-white/10 bg-white/5 px-3 py-4 text-center text-xs text-muted-foreground">
        <div className="mb-2 flex justify-center">
          <CardBrandIcon brand={displayBrand} />
        </div>
        Sem cartão emitido
      </div>
    );
  }

  const usedLimit = Math.max(0, Number(card.used_limit || 0));
  const currentLimit = Math.max(0, Number(card.card_limit || 0));
  const draftLimit = Math.max(0, parseCurrency(draft));
  const sliderMax = Math.max(
    10000,
    usedLimit,
    currentLimit,
    draftLimit,
    getCardBrandDefaultLimit(policy, card.brand)
  ) * 2;
  const saveDisabled = saving || draftLimit < usedLimit || Math.abs(draftLimit - currentLimit) < 0.01;

  return (
    <div className="min-w-[220px] space-y-3 rounded-lg border border-white/10 bg-white/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CardBrandIcon brand={card.brand} />
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{getBrandLabel(card.brand)}</p>
            <p className="text-xs text-muted-foreground">Final {card.card_number?.slice(-4) || '----'}</p>
          </div>
        </div>
        <Badge variant="outline" className="border-white/10 text-xs">
          Usado {formatCurrency(usedLimit)}
        </Badge>
      </div>
      <Input
        value={draft || ''}
        onChange={(event) => onDraftChange(formatCurrency(event.target.value, true))}
        className="h-8"
      />
      <Slider
        value={[Math.max(usedLimit, Math.min(sliderMax, draftLimit))]}
        min={usedLimit}
        max={sliderMax}
        step={100}
        onValueChange={([value]) => onDraftChange(formatCurrency(value, true))}
      />
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Atual: {formatCurrency(currentLimit)}</span>
        <span>Máx. barra: {formatCurrency(sliderMax)}</span>
      </div>
      {draftLimit < usedLimit ? (
        <p className="text-xs text-red-300">O limite não pode ficar abaixo do valor já utilizado.</p>
      ) : null}
      <Button size="sm" className="w-full" onClick={onSave} disabled={saveDisabled}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Salvar limite
      </Button>
    </div>
  );
};

const RequestPagination = ({ page, total, onPageChange }) => {
  const totalPages = Math.max(1, Math.ceil(total / REQUESTS_PAGE_SIZE));
  const first = total ? (page - 1) * REQUESTS_PAGE_SIZE + 1 : 0;
  const last = Math.min(page * REQUESTS_PAGE_SIZE, total);

  return (
    <div className="mt-4 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-4 sm:flex-row">
      <p className="text-sm text-muted-foreground">{first}–{last} de {total}</p>
      <div className="flex items-center gap-2" aria-label="Paginação das solicitações">
        <Button type="button" size="sm" variant="outline" onClick={() => onPageChange(page - 1)} disabled={page <= 1}>
          <ChevronLeft className="mr-1 h-4 w-4" />Anterior
        </Button>
        <span className="min-w-16 text-center text-sm">{page} / {totalPages}</span>
        <Button type="button" size="sm" variant="outline" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
          Próxima<ChevronRight className="ml-1 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
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
  const [accounts, setAccounts] = useState([]);
  const [issuedCards, setIssuedCards] = useState([]);
  const [profilesById, setProfilesById] = useState({});
  const [cardLimits, setCardLimits] = useState({});
  const [cardBrands, setCardBrands] = useState({});
  const [issuedCardLimits, setIssuedCardLimits] = useState({});
  const [loanInstallments, setLoanInstallments] = useState({});
  const [feedbackById, setFeedbackById] = useState({});
  const [savingIssuedCardId, setSavingIssuedCardId] = useState(null);
  const [activeRequestTab, setActiveRequestTab] = useState('cards');
  const [cardPage, setCardPage] = useState(1);
  const [loanPage, setLoanPage] = useState(1);
  const [cardCount, setCardCount] = useState(0);
  const [loanCount, setLoanCount] = useState(0);
  const [requestsLoading, setRequestsLoading] = useState(false);

  const canManage = canManageNationalBank(user);

  const fetchProfiles = useCallback(async (userIds = []) => {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (!ids.length) {
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id, full_name, username, avatar_url')
      .in('id', ids);

    if (error) {
      throw error;
    }

    setProfilesById((current) => ({
      ...current,
      ...(data || []).reduce((accumulator, profile) => {
        accumulator[profile.id] = profile;
        return accumulator;
      }, {}),
    }));
  }, []);

  const fetchData = useCallback(async (showLoading = true) => {
    if (!canManage) {
      setLoading(false);
      return;
    }

    if (showLoading) setLoading(true);
    try {
      const [policyResponse, economicPolicyResponse, economicStateResponse, accountsResponse, issuedCardsResponse] = await Promise.all([
        supabase.from('system_settings').select('value').eq('key', BANK_POLICY_SETTINGS_KEY).maybeSingle(),
        supabase.from('system_settings').select('value').eq('key', ECONOMIC_POLICY_SETTINGS_KEY).maybeSingle(),
        supabase.from('economic_state').select('current_selic').eq('id', true).single(),
        supabase.from('accounts').select('id, user_id, account_number, agency_number, balance').order('created_at', { ascending: false }).limit(200),
        supabase.from('cards').select('*').order('created_at', { ascending: false }).limit(300),
      ]);

      if (policyResponse.error) {
        throw policyResponse.error;
      }

      if (economicPolicyResponse.error) {
        throw economicPolicyResponse.error;
      }

      if (economicStateResponse.error) {
        throw economicStateResponse.error;
      }

      if (accountsResponse.error) {
        throw accountsResponse.error;
      }

      if (issuedCardsResponse.error) {
        throw issuedCardsResponse.error;
      }

      const normalizedEconomicPolicy = normalizeEconomicPolicy({
        ...economicPolicyResponse.data?.value,
        selic_rate: economicStateResponse.data.current_selic,
      });
      const normalizedPolicy = normalizeBankPolicy(
        normalizeBankPolicyForEconomicPolicy(
          policyResponse.data?.value,
          normalizedEconomicPolicy,
          DEFAULT_BANK_POLICY
        )
      );
      const accountRows = accountsResponse.data || [];
      const issuedCardRows = issuedCardsResponse.data || [];

      setEconomicPolicy(normalizedEconomicPolicy);
      setPolicy(normalizedPolicy);
      setAccounts(accountRows);
      setIssuedCards(issuedCardRows);
      setIssuedCardLimits(
        issuedCardRows.reduce((accumulator, card) => {
          accumulator[card.id] = formatCurrency(Number(card.card_limit || 0), true);
          return accumulator;
        }, {})
      );
      await fetchProfiles([
        ...accountRows.map((account) => account.user_id),
        ...issuedCardRows.map((card) => card.user_id),
      ]);
    } catch (error) {
      toast({ title: 'Erro ao carregar gestão bancária', description: error.message, variant: 'destructive' });
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [canManage, fetchProfiles, toast]);

  const fetchRequests = useCallback(async (type, showLoading = true) => {
    if (!canManage) return;
    const isCards = type === 'cards';
    const page = isCards ? cardPage : loanPage;
    const from = (page - 1) * REQUESTS_PAGE_SIZE;
    const to = from + REQUESTS_PAGE_SIZE - 1;

    if (showLoading) setRequestsLoading(true);
    try {
      const { data, error, count } = await supabase
        .from(isCards ? 'credit_card_applications' : 'loan_applications')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

      if (error) throw error;
      const rows = data || [];
      const total = count || 0;
      const maximumPage = Math.max(1, Math.ceil(total / REQUESTS_PAGE_SIZE));

      if (page > maximumPage) {
        if (isCards) setCardPage(maximumPage);
        else setLoanPage(maximumPage);
        return;
      }

      if (isCards) {
        setCreditApplications(rows);
        setCardCount(total);
        setCardBrands((current) => ({
          ...rows.reduce((accumulator, application) => {
            accumulator[application.id] = current[application.id]
              || normalizeCardBrand(application.approved_brand || application.brand);
            return accumulator;
          }, {}),
        }));
        setCardLimits((current) => ({
          ...current,
          ...rows.reduce((accumulator, application) => {
            const brand = normalizeCardBrand(application.approved_brand || application.brand);
            accumulator[application.id] = current[application.id] || formatCurrency(
              Number(application.requested_limit || getCardBrandDefaultLimit(policy, brand) || 0),
              true
            );
            return accumulator;
          }, {}),
        }));
      } else {
        setLoanApplications(rows);
        setLoanCount(total);
        setLoanInstallments((current) => ({
          ...current,
          ...rows.reduce((accumulator, application) => {
            accumulator[application.id] = current[application.id] || String(application.installments || 12);
            return accumulator;
          }, {}),
        }));
      }

      await fetchProfiles(rows.map((application) => application.user_id));
    } catch (error) {
      toast({
        title: `Erro ao carregar solicitações de ${isCards ? 'cartão' : 'empréstimo'}`,
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      if (showLoading) setRequestsLoading(false);
    }
  }, [canManage, cardPage, fetchProfiles, loanPage, policy, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    void fetchRequests(activeRequestTab);
  }, [activeRequestTab, fetchRequests]);

  useEffect(() => {
    if (!canManage) return undefined;

    let refreshTimer;
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => fetchData(false), 250);
    };
    let channel = supabase.channel('bank-management-core-live');

    [
      'economic_state',
      'system_settings',
      'investment_options',
      'accounts',
      'cards',
    ].forEach((table) => {
      channel = channel.on('postgres_changes', {
        event: '*', schema: 'public', table,
      }, scheduleRefresh);
    });

    channel.subscribe();
    return () => {
      window.clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [canManage, fetchData]);

  useEffect(() => {
    if (!canManage) return undefined;

    let refreshTimer;
    const scheduleRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void fetchRequests(activeRequestTab, false);
      }, 250);
    };
    let channel = supabase.channel('bank-management-requests-live');
    ['credit_card_applications', 'loan_applications'].forEach((table) => {
      channel = channel.on('postgres_changes', {
        event: '*', schema: 'public', table,
      }, scheduleRefresh);
    });
    channel.subscribe();

    return () => {
      window.clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [activeRequestTab, canManage, fetchRequests]);

  const pendingCreditApplications = useMemo(
    () => creditApplications.filter((application) => isPendingStatus(application.status)),
    [creditApplications]
  );
  const pendingLoanApplications = useMemo(
    () => loanApplications.filter((application) => isPendingStatus(application.status)),
    [loanApplications]
  );
  const getProfileName = useCallback(
    (userId) => profilesById[userId]?.full_name || profilesById[userId]?.username || 'Cidadão',
    [profilesById]
  );
  const getProfile = useCallback(
    (userId) => profilesById[userId] || {},
    [profilesById]
  );

  const cardsByUserId = useMemo(
    () =>
      issuedCards.reduce((accumulator, card) => {
        if (!card?.user_id) return accumulator;
        if (!accumulator[card.user_id]) accumulator[card.user_id] = [];
        accumulator[card.user_id].push(card);
        return accumulator;
      }, {}),
    [issuedCards]
  );

  const accountHolders = useMemo(() => {
    const holdersByUserId = new Map();

    accounts.forEach((account) => {
      if (account?.user_id) {
        holdersByUserId.set(account.user_id, { account, userId: account.user_id });
      }
    });

    issuedCards.forEach((card) => {
      if (card?.user_id && !holdersByUserId.has(card.user_id)) {
        holdersByUserId.set(card.user_id, { account: null, userId: card.user_id });
      }
    });

    return [...holdersByUserId.values()].sort((left, right) =>
      getProfileName(left.userId).localeCompare(getProfileName(right.userId), 'pt-BR')
    );
  }, [accounts, issuedCards, profilesById]);

  const updatePolicyRate = (field, value) => {
    const nextValue = Number(value);
    const nextRate = Number.isFinite(nextValue) ? nextValue : 0;
    const spreadField = RATE_TO_SPREAD_FIELD[field];
    const selicMonthlyRate = annualPercentToMonthlyPercent(economicPolicy.selic_rate);

    setPolicy((current) => ({
      ...current,
      [field]: nextRate,
      ...(spreadField ? { [spreadField]: Math.max(0, nextRate - selicMonthlyRate) } : {}),
    }));
  };

  const updateBrandLimit = (brand, value) => {
    setPolicy((current) => ({
      ...current,
      credit_card_brand_limits: {
        ...(current.credit_card_brand_limits || {}),
        [brand]: parseCurrency(value),
      },
      credit_card_default_limit: Math.max(
        parseCurrency(value),
        Number(current.credit_card_default_limit || 0)
      ),
    }));
  };

  const updateApplicationBrand = (application, brand) => {
    const normalizedBrand = normalizeCardBrand(brand);
    setCardBrands((current) => ({ ...current, [application.id]: normalizedBrand }));
    setCardLimits((current) => ({
      ...current,
      [application.id]: formatCurrency(getCardBrandDefaultLimit(policy, normalizedBrand), true),
    }));
  };

  const handleSavePolicy = async () => {
    setSavingPolicy(true);
    const nextPolicy = normalizeBankPolicy(
      normalizeBankPolicyForEconomicPolicy(policy, economicPolicy, DEFAULT_BANK_POLICY)
    );
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
      toast({ title: 'Política do Banco Nacional atualizada' });
      void fetchData(false);
    }
    setSavingPolicy(false);
  };

  const handleCardDecision = async (application, action) => {
    setProcessingId(application.id);
    try {
      const isApproval = action === 'approve';
      const rpcName = isApproval ? 'approve_credit_card_application' : 'reject_credit_card_application';
      const params = isApproval
        ? {
            p_application_id: application.id,
            p_card_limit: parseCurrency(cardLimits[application.id]),
            p_brand: normalizeCardBrand(cardBrands[application.id] || application.brand),
          }
        : { p_application_id: application.id, p_feedback: feedbackById[application.id] || null };
      const { data, error } = await supabase.rpc(rpcName, params);

      if (error || data?.success === false) {
        throw new Error(data?.message || error?.message || 'Não foi possível revisar a solicitação.');
      }

      toast({ title: isApproval ? 'Cartão aprovado' : 'Cartão rejeitado', description: data?.message });
      setCreditApplications((current) => current.map((item) => (
        item.id === application.id
          ? { ...item, status: isApproval ? 'Aprovado' : 'Rejeitado' }
          : item
      )));
      await Promise.all([
        fetchRequests('cards', false),
        fetchData(false),
      ]);
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
      setLoanApplications((current) => current.map((item) => (
        item.id === application.id
          ? { ...item, status: isApproval ? 'Aprovado' : 'Rejeitado' }
          : item
      )));
      await fetchRequests('loans', false);
    } catch (error) {
      toast({ title: 'Erro na revisão do empréstimo', description: error.message, variant: 'destructive' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleSaveIssuedCardLimit = async (card) => {
    const nextLimit = parseCurrency(issuedCardLimits[card.id]);
    const usedLimit = Number(card.used_limit || 0);

    if (nextLimit < usedLimit) {
      toast({
        title: 'Limite inválido',
        description: 'O limite aprovado não pode ser menor do que o valor já utilizado no cartão.',
        variant: 'destructive',
      });
      return;
    }

    setSavingIssuedCardId(card.id);
    try {
      const { data, error } = await supabase.rpc('set_credit_card_limit', {
        p_card_id: card.id,
        p_card_limit: nextLimit,
      });

      if (error || data?.success === false) {
        throw new Error(data?.message || error?.message || 'Não foi possível atualizar o limite do cartão.');
      }

      toast({ title: 'Limite atualizado', description: data?.message || 'O limite do cartão foi salvo.' });
      void fetchData(false);
    } catch (error) {
      toast({ title: 'Erro ao atualizar limite', description: error.message, variant: 'destructive' });
    } finally {
      setSavingIssuedCardId(null);
    }
  };

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
            Aprove crédito, revise empréstimos, defina limites por bandeira e configure taxas do banco estatal.
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
            <Label>Limite padrão Visa</Label>
            <Input
              value={formatCurrency(policy.credit_card_brand_limits?.visa || 0, true)}
              onChange={(event) => updateBrandLimit('visa', event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Limite padrão Mastercard</Label>
            <Input
              value={formatCurrency(policy.credit_card_brand_limits?.mastercard || 0, true)}
              onChange={(event) => updateBrandLimit('mastercard', event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Taxa de câmbio</Label>
            <Select
              value={getExchangeFeeMode(policy)}
              onValueChange={(value) =>
                setPolicy((current) => ({
                  ...current,
                  exchange_fee_free: value === 'free',
                  exchange_fee_type: value === 'fixed' ? 'fixed' : 'percentage',
                  exchange_fee_rate: value === 'free' ? 0 : Number(current.exchange_fee_rate || 0),
                  exchange_fee_fixed_amount: value === 'free' ? 0 : Number(current.exchange_fee_fixed_amount || 0),
                }))
              }
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="free">Gratuita</SelectItem>
                <SelectItem value="percentage">Cobrar em porcentagem</SelectItem>
                <SelectItem value="fixed">Cobrar valor fixo em R$</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            {getExchangeFeeMode(policy) === 'fixed' ? (
              <>
                <Label>Valor do câmbio (R$ por operação)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    disabled={policy.exchange_fee_free}
                    value={formatCurrency(policy.exchange_fee_fixed_amount || 0, true)}
                    onChange={(event) =>
                      setPolicy((current) => ({
                        ...current,
                        exchange_fee_fixed_amount: parseCurrency(event.target.value),
                        exchange_fee_type: 'fixed',
                        exchange_fee_free: false,
                      }))
                    }
                  />
                  <ArrowRightLeft className="h-4 w-4 text-muted-foreground" />
                </div>
              </>
            ) : (
              <>
                <Label>Percentual do câmbio (% por operação)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    disabled={policy.exchange_fee_free}
                    value={policy.exchange_fee_free ? 0 : policy.exchange_fee_rate}
                    onChange={(event) =>
                      setPolicy((current) => ({
                        ...current,
                        exchange_fee_rate: Math.min(100, Math.max(0, Number(event.target.value || 0))),
                        exchange_fee_type: 'percentage',
                        exchange_fee_free: false,
                      }))
                    }
                  />
                  <Percent className="h-4 w-4 text-muted-foreground" />
                </div>
              </>
            )}
          </div>
          <div className="md:col-span-2 xl:col-span-4">
            <Button onClick={handleSavePolicy} disabled={savingPolicy}>
              {savingPolicy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              Salvar Política do Banco
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="glass-effect">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><WalletCards className="h-5 w-5 text-emerald-400" /> Limites por Titular e Bandeira</CardTitle>
          <CardDescription>
            Ajuste os limites de cartões emitidos para cada titular. Visa e Mastercard são controlados separadamente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {accountHolders.length ? (
            <div className={accountHolders.length > 10 ? 'max-h-[75vh] overflow-y-auto pr-2 custom-scrollbar' : ''}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Titular</TableHead>
                    <TableHead>Conta</TableHead>
                    <TableHead>Visa</TableHead>
                    <TableHead>Mastercard</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accountHolders.map(({ account, userId }) => {
                    const profile = getProfile(userId);
                    const userCards = cardsByUserId[userId] || [];
                    const cardByBrand = CREDIT_CARD_BRANDS.reduce((accumulator, brand) => {
                      accumulator[brand.value] = userCards.find((card) =>
                        normalizeCardBrand(card.brand) === brand.value && card.is_active !== false
                      );
                      return accumulator;
                    }, {});

                    return (
                      <TableRow key={userId}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-9 w-9 border border-white/10">
                              <AvatarImage src={profile.avatar_url} alt={getProfileName(userId)} />
                              <AvatarFallback>{getProfileInitials(profile)}</AvatarFallback>
                            </Avatar>
                            <span className="font-medium">{getProfileName(userId)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {account ? `Ag. ${account.agency_number || '0000'} / Cc. ${formatAccount(account.account_number || '')}` : 'Sem conta localizada'}
                        </TableCell>
                        {CREDIT_CARD_BRANDS.map((brand) => {
                          const card = cardByBrand[brand.value];
                          return (
                            <TableCell key={brand.value} className="align-top">
                              <CardLimitControl
                                card={card}
                                brand={brand.value}
                                draft={card ? issuedCardLimits[card.id] : ''}
                                policy={policy}
                                saving={savingIssuedCardId === card?.id}
                                onDraftChange={(value) => setIssuedCardLimits((current) => ({ ...current, [card.id]: value }))}
                                onSave={() => handleSaveIssuedCardLimit(card)}
                              />
                            </TableCell>
                          );
                        })}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="py-6 text-center text-muted-foreground">Nenhum titular com conta ou cartão encontrado.</p>
          )}
        </CardContent>
      </Card>

      <Tabs value={activeRequestTab} onValueChange={setActiveRequestTab} className="space-y-4">
        <div className="overflow-x-auto pb-1 custom-scrollbar">
          <TabsList className="flex h-auto min-w-max justify-start p-1">
            <TabsTrigger className="shrink-0 px-4 py-2.5" value="cards">
              <CreditCard className="mr-2 h-4 w-4" />Solicitações de Cartão
            </TabsTrigger>
            <TabsTrigger className="shrink-0 px-4 py-2.5" value="loans">
              <Landmark className="mr-2 h-4 w-4" />Solicitações de Empréstimo
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="cards">
          <Card className="glass-effect">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-sky-400" /> Solicitações de Cartão</CardTitle>
              <CardDescription>{pendingCreditApplications.length} pendente(s) nesta página. Mais recentes primeiro.</CardDescription>
            </CardHeader>
            <CardContent>
              {requestsLoading ? (
                <div className="flex min-h-52 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
              ) : creditApplications.length ? (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow><TableHead>Cidadão</TableHead><TableHead>Bandeira</TableHead><TableHead>Status</TableHead><TableHead>Limite</TableHead><TableHead>Feedback</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {creditApplications.map((application) => {
                          const pending = isPendingStatus(application.status);
                          return (
                            <TableRow key={application.id}>
                              <TableCell>{getProfileName(application.user_id)}</TableCell>
                              <TableCell>{pending ? <Select value={cardBrands[application.id] || normalizeCardBrand(application.brand)} onValueChange={(value) => updateApplicationBrand(application, value)}><SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger><SelectContent>{CREDIT_CARD_BRANDS.map((brand) => <SelectItem key={brand.value} value={brand.value}>{brand.label}</SelectItem>)}</SelectContent></Select> : <span className="capitalize">{getBrandLabel(application.approved_brand || application.brand)}</span>}</TableCell>
                              <TableCell><Badge className={`border ${getStatusBadgeClass(application.status)}`}>{application.status}</Badge></TableCell>
                              <TableCell>{pending ? <Input aria-label={`Limite para ${getProfileName(application.user_id)}`} className="h-8 w-32" value={cardLimits[application.id] || ''} onChange={(event) => setCardLimits((current) => ({ ...current, [application.id]: formatCurrency(event.target.value, true) }))} /> : formatCurrency(application.approved_limit || application.requested_limit || 0)}</TableCell>
                              <TableCell>{pending ? <Textarea aria-label={`Feedback para ${getProfileName(application.user_id)}`} className="min-h-8 w-48" value={feedbackById[application.id] || ''} onChange={(event) => setFeedbackById((current) => ({ ...current, [application.id]: event.target.value }))} placeholder="Motivo opcional" /> : application.admin_feedback || application.feedback || '-'}</TableCell>
                              <TableCell className="text-right">{pending ? <div className="flex justify-end gap-2"><Button size="sm" onClick={() => handleCardDecision(application, 'approve')} disabled={processingId === application.id}>{processingId === application.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}Aprovar</Button><Button size="sm" variant="destructive" onClick={() => handleCardDecision(application, 'reject')} disabled={processingId === application.id}><XCircle className="mr-1 h-4 w-4" />Rejeitar</Button></div> : '-'}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  <RequestPagination page={cardPage} total={cardCount} onPageChange={setCardPage} />
                </>
              ) : <p className="py-10 text-center text-muted-foreground">Nenhuma solicitação de cartão encontrada.</p>}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="loans">
          <Card className="glass-effect">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Landmark className="h-5 w-5 text-amber-400" /> Solicitações de Empréstimo</CardTitle>
              <CardDescription>{pendingLoanApplications.length} pendente(s) nesta página. Juros atuais: {Number(policy.loan_interest_rate || 0).toFixed(2)}% a.m.</CardDescription>
            </CardHeader>
            <CardContent>
              {requestsLoading ? (
                <div className="flex min-h-52 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-primary" /></div>
              ) : loanApplications.length ? (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader><TableRow><TableHead>Cidadão</TableHead><TableHead>Valor</TableHead><TableHead>Status</TableHead><TableHead>Parcelas</TableHead><TableHead>Total estimado</TableHead><TableHead>Feedback</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {loanApplications.map((application) => {
                          const pending = isPendingStatus(application.status);
                          const rate = Number(application.interest_rate ?? policy.loan_interest_rate ?? 0);
                          const totalDue = Number(application.total_due || application.amount * (1 + rate / 100));
                          return (
                            <TableRow key={application.id}>
                              <TableCell>{getProfileName(application.user_id)}</TableCell><TableCell>{formatCurrency(application.amount || 0)}</TableCell><TableCell><Badge className={`border ${getStatusBadgeClass(application.status)}`}>{application.status}</Badge></TableCell>
                              <TableCell>{pending ? <Input aria-label={`Parcelas para ${getProfileName(application.user_id)}`} type="number" min="1" className="h-8 w-20" value={loanInstallments[application.id] || '12'} onChange={(event) => setLoanInstallments((current) => ({ ...current, [application.id]: event.target.value }))} /> : application.installments || '-'}</TableCell>
                              <TableCell>{formatCurrency(totalDue)}</TableCell>
                              <TableCell>{pending ? <Textarea aria-label={`Feedback para ${getProfileName(application.user_id)}`} className="min-h-8 w-48" value={feedbackById[application.id] || ''} onChange={(event) => setFeedbackById((current) => ({ ...current, [application.id]: event.target.value }))} placeholder="Motivo opcional" /> : application.admin_feedback || application.feedback || '-'}</TableCell>
                              <TableCell className="text-right">{pending ? <div className="flex justify-end gap-2"><Button size="sm" onClick={() => handleLoanDecision(application, 'approve')} disabled={processingId === application.id}>{processingId === application.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />}Aprovar</Button><Button size="sm" variant="destructive" onClick={() => handleLoanDecision(application, 'reject')} disabled={processingId === application.id}><XCircle className="mr-1 h-4 w-4" />Rejeitar</Button></div> : '-'}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                  <RequestPagination page={loanPage} total={loanCount} onPageChange={setLoanPage} />
                </>
              ) : <p className="py-10 text-center text-muted-foreground">Nenhuma solicitação de empréstimo encontrada.</p>}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default BankManagementPanel;
