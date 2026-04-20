import process from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { fetchExecutiveConstitutionalState } from '../../src/lib/executiveGovernance.js';
import {
  SALARY_ROLE_PRIORITY,
  SALARY_TABLE,
  getWeeklyPayrollWindowStart,
  normalizeSalaryRole,
} from '../../src/lib/salaryRules.js';

let serverSupabase;

const SALARY_INFO_BY_ROLE = SALARY_TABLE.reduce((accumulator, item) => {
  accumulator[item.role] = item;
  return accumulator;
}, {});

const json = (response, statusCode, payload) => {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(payload));
};

const handleOptions = (request, response) => {
  if (request.method !== 'OPTIONS') {
    return false;
  }

  response.statusCode = 204;
  response.end();
  return true;
};

const ensureMethod = (request, response, allowedMethods) => {
  if (handleOptions(request, response)) {
    return false;
  }

  if (!allowedMethods.includes(request.method)) {
    response.setHeader('Allow', `${allowedMethods.join(', ')}, OPTIONS`);
    json(response, 405, { error: 'Metodo nao permitido.' });
    return false;
  }

  return true;
};

const getRequiredServerEnv = (name) => {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`A variavel ${name} nao foi configurada no servidor.`);
  }

  return value;
};

const getServerSupabase = () => {
  if (!serverSupabase) {
    serverSupabase = createClient(
      getRequiredServerEnv('VITE_SUPABASE_URL'),
      getRequiredServerEnv('SUPABASE_SECRET_KEY'),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );
  }

  return serverSupabase;
};

const dedupe = (values = []) => [...new Set(values.filter(Boolean))];

const isActiveTerm = (termEndAt) => {
  if (!termEndAt) {
    return true;
  }

  const termEndTime = new Date(termEndAt).getTime();
  return Number.isFinite(termEndTime) && termEndTime > Date.now();
};

const fetchActiveElectionAssignments = async (supabase) => {
  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'election_office_sync')
    .maybeSingle();

  if (error) {
    throw error;
  }

  const assignments = Array.isArray(data?.value?.active_assignments)
    ? data.value.active_assignments
    : [];

  return assignments
    .filter((assignment) =>
      assignment?.user_id &&
      ['Deputado', 'Senador'].includes(assignment?.office_role) &&
      isActiveTerm(assignment?.term_end_at)
    )
    .map((assignment) => ({
      userId: assignment.user_id,
      role: assignment.office_role,
    }));
};

const fetchCurrentExecutiveTicketRoles = async (supabase) => {
  const executiveState = await fetchExecutiveConstitutionalState(supabase);
  const roles = [];

  if (!executiveState?.isVacant && executiveState?.currentPresidentProfile?.id) {
    roles.push({
      userId: executiveState.currentPresidentProfile.id,
      role: 'Presidente',
    });
  }

  if (executiveState?.currentViceProfile?.id) {
    roles.push({
      userId: executiveState.currentViceProfile.id,
      role: 'Vice-Presidente',
    });
  }

  return roles;
};

const fetchActiveMinisters = async (supabase) => {
  const { data, error } = await supabase
    .from('ministers')
    .select('user_id');

  if (error) {
    throw error;
  }

  return dedupe((data || []).map((row) => row.user_id)).map((userId) => ({
    userId,
    role: 'Ministro',
  }));
};

const fetchActiveHousePresidents = async (supabase) => {
  const { data: terms, error: termsError } = await supabase
    .from('parliament_leadership_terms')
    .select('house_id, member_id, status, position, term_start_date, term_end_date')
    .eq('status', 'active')
    .eq('position', 'president');

  if (termsError) {
    throw termsError;
  }

  const activeTerms = (terms || []).filter((term) => {
    if (term?.term_end_date && term.term_end_date < new Date().toISOString().slice(0, 10)) {
      return false;
    }

    return true;
  });

  const memberIds = dedupe(activeTerms.map((term) => term.member_id));
  const houseIds = dedupe(activeTerms.map((term) => term.house_id));

  if (!memberIds.length || !houseIds.length) {
    return [];
  }

  const [{ data: members, error: membersError }, { data: houses, error: housesError }] = await Promise.all([
    supabase.from('parliament_members').select('id, user_id').in('id', memberIds),
    supabase.from('parliament_houses').select('id, name').in('id', houseIds),
  ]);

  if (membersError) {
    throw membersError;
  }

  if (housesError) {
    throw housesError;
  }

  const membersMap = (members || []).reduce((accumulator, member) => {
    accumulator[member.id] = member.user_id;
    return accumulator;
  }, {});
  const housesMap = (houses || []).reduce((accumulator, house) => {
    accumulator[house.id] = house.name || '';
    return accumulator;
  }, {});

  return activeTerms
    .map((term) => {
      const userId = membersMap[term.member_id];
      const houseName = `${housesMap[term.house_id] || ''}`.toLowerCase();
      const role = houseName.includes('senado') ? 'Presidente do Senado' : 'Presidente da Câmara';

      if (!userId) {
        return null;
      }

      return {
        userId,
        role,
      };
    })
    .filter(Boolean);
};

const fetchProfileFallbackRoles = async (supabase) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role')
    .in('role', [
      'Deputado',
      'Senador',
      'Presidente do Senado',
      'Presidente da Câmara',
      'Ministro',
    ]);

  if (error) {
    throw error;
  }

  return (data || [])
    .map((profile) => ({
      userId: profile.id,
      role: profile.role,
    }))
    .filter((entry) => entry.userId && entry.role);
};

const resolveEligibleRecipients = async (supabase, payrollWindowStart) => {
  const [
    assignmentRoles,
    executiveTicketRoles,
    ministerRoles,
    housePresidentRoles,
    profileFallbackRoles,
  ] = await Promise.all([
    fetchActiveElectionAssignments(supabase),
    fetchCurrentExecutiveTicketRoles(supabase),
    fetchActiveMinisters(supabase),
    fetchActiveHousePresidents(supabase),
    fetchProfileFallbackRoles(supabase),
  ]);

  const rolePoolByUser = new Map();
  const registerRole = (userId, role) => {
    const normalizedRole = normalizeSalaryRole(role);

    if (!userId || !normalizedRole || !SALARY_INFO_BY_ROLE[normalizedRole]) {
      return;
    }

    if (!rolePoolByUser.has(userId)) {
      rolePoolByUser.set(userId, new Set());
    }

    rolePoolByUser.get(userId).add(normalizedRole);
  };

  [
    ...assignmentRoles,
    ...executiveTicketRoles,
    ...ministerRoles,
    ...housePresidentRoles,
    ...profileFallbackRoles,
  ].forEach((entry) => registerRole(entry.userId, entry.role));

  const userIds = [...rolePoolByUser.keys()];

  if (!userIds.length) {
    return [];
  }

  const [{ data: accounts, error: accountsError }, { data: payments, error: paymentsError }] = await Promise.all([
    supabase.from('accounts').select('id, user_id, balance').in('user_id', userIds),
    supabase
      .from('salary_payments')
      .select('user_id, paid_at')
      .gte('paid_at', payrollWindowStart.toISOString())
      .in('user_id', userIds),
  ]);

  if (accountsError) {
    throw accountsError;
  }

  if (paymentsError) {
    throw paymentsError;
  }

  const accountsMap = (accounts || []).reduce((accumulator, account) => {
    accumulator[account.user_id] = account;
    return accumulator;
  }, {});
  const alreadyPaidUserIds = new Set((payments || []).map((payment) => payment.user_id));

  return userIds
    .map((userId) => {
      const roles = [...(rolePoolByUser.get(userId) || [])];
      const selectedRole = SALARY_ROLE_PRIORITY.find((role) => roles.includes(role));
      const account = accountsMap[userId];
      const salaryInfo = selectedRole ? SALARY_INFO_BY_ROLE[selectedRole] : null;

      if (!selectedRole || !salaryInfo || !account || alreadyPaidUserIds.has(userId)) {
        return null;
      }

      return {
        userId,
        accountId: account.id,
        role: selectedRole,
        title: salaryInfo.title,
        amount: Number(salaryInfo.salary || 0),
      };
    })
    .filter((entry) => entry && entry.amount > 0);
};

const insertFailureNotifications = async (supabase, recipients, payrollWindowStart) => {
  if (!recipients.length) {
    return 0;
  }

  const userIds = recipients.map((recipient) => recipient.userId);
  const { data: existingNotifications, error: notificationsError } = await supabase
    .from('notifications')
    .select('id, user_id, metadata')
    .eq('type', 'salary_payment_failed')
    .in('user_id', userIds);

  if (notificationsError) {
    throw notificationsError;
  }

  const windowKey = payrollWindowStart.toISOString();
  const existingKeys = new Set(
    (existingNotifications || [])
      .filter((notification) => notification?.metadata?.payroll_window_start === windowKey)
      .map((notification) => `${notification.user_id}:${windowKey}`)
  );

  const notificationsToInsert = recipients
    .filter((recipient) => !existingKeys.has(`${recipient.userId}:${windowKey}`))
    .map((recipient) => ({
      user_id: recipient.userId,
      type: 'salary_payment_failed',
      content: `Nao foi possivel pagar o salario semanal de ${recipient.title} por falta de verba no cofre do governo.`,
      link: '/services/bank',
      is_read: false,
      metadata: {
        popup_pending: true,
        popup_shown_at: null,
        payroll_window_start: windowKey,
        expected_amount: recipient.amount,
        role: recipient.role,
        reason: 'insufficient_funds',
      },
    }));

  if (!notificationsToInsert.length) {
    return 0;
  }

  const { error: insertError } = await supabase.from('notifications').insert(notificationsToInsert);

  if (insertError) {
    throw insertError;
  }

  return notificationsToInsert.length;
};

export const processWeeklySalaries = async () => {
  const supabase = getServerSupabase();
  const payrollWindowStart = getWeeklyPayrollWindowStart(new Date());
  const recipients = await resolveEligibleRecipients(supabase, payrollWindowStart);

  if (!recipients.length) {
    return {
      success: true,
      message: 'Nenhum salario pendente para a janela atual.',
      processedCount: 0,
      totalAmount: 0,
      payrollWindowStart: payrollWindowStart.toISOString(),
      failedDueToFunds: false,
    };
  }

  const { data: governmentFinance, error: financesError } = await supabase
    .from('government_finances')
    .select('id, treasury_balance')
    .order('updated_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (financesError) {
    throw financesError;
  }

  if (!governmentFinance?.id) {
    throw new Error('Nao foi possivel localizar as financas do governo.');
  }

  const totalAmount = recipients.reduce((sum, recipient) => sum + recipient.amount, 0);

  if (Number(governmentFinance.treasury_balance || 0) < totalAmount) {
    const failureNotifications = await insertFailureNotifications(supabase, recipients, payrollWindowStart);

    return {
      success: false,
      message: 'Saldo insuficiente no cofre publico para processar os salarios.',
      processedCount: 0,
      totalAmount,
      payrollWindowStart: payrollWindowStart.toISOString(),
      failedDueToFunds: true,
      availableBalance: Number(governmentFinance.treasury_balance || 0),
      notificationsCreated: failureNotifications,
    };
  }

  let treasuryBalance = Number(governmentFinance.treasury_balance || 0);
  let processedCount = 0;

  for (const recipient of recipients) {
    treasuryBalance -= recipient.amount;

    const { error: treasuryError } = await supabase
      .from('government_finances')
      .update({
        treasury_balance: treasuryBalance,
        updated_at: new Date().toISOString(),
      })
      .eq('id', governmentFinance.id);

    if (treasuryError) {
      throw treasuryError;
    }

    const { data: accountRow, error: accountError } = await supabase
      .from('accounts')
      .select('balance')
      .eq('id', recipient.accountId)
      .maybeSingle();

    if (accountError) {
      throw accountError;
    }

    const { error: updateAccountError } = await supabase
      .from('accounts')
      .update({
        balance: Number(accountRow?.balance || 0) + recipient.amount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', recipient.accountId);

    if (updateAccountError) {
      throw updateAccountError;
    }

    const { data: paymentRow, error: paymentError } = await supabase
      .from('salary_payments')
      .insert({
        user_id: recipient.userId,
        role: recipient.role,
        amount: recipient.amount,
        paid_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (paymentError) {
      throw paymentError;
    }

    const { error: transactionError } = await supabase
      .from('transactions')
      .insert({
        from_account_id: null,
        to_account_id: recipient.accountId,
        amount: recipient.amount,
        type: 'salary_payment',
        description: `Pagamento semanal de salario: ${recipient.title}`,
        created_at: new Date().toISOString(),
        metadata: {
          role: recipient.role,
          salary_payment_id: paymentRow?.id || null,
          payroll_window_start: payrollWindowStart.toISOString(),
        },
      });

    if (transactionError) {
      throw transactionError;
    }

    processedCount += 1;
  }

  return {
    success: true,
    message: `${processedCount} salario(s) processados com sucesso.`,
    processedCount,
    totalAmount,
    payrollWindowStart: payrollWindowStart.toISOString(),
    failedDueToFunds: false,
  };
};

export const processWeeklySalariesHandler = async (request, response) => {
  if (!ensureMethod(request, response, ['GET', 'POST'])) {
    return;
  }

  try {
    const payload = await processWeeklySalaries();
    json(response, 200, payload);
  } catch (error) {
    console.error('[salaries:process]', error);
    json(response, 500, {
      error: error instanceof Error ? error.message : 'Nao foi possivel processar os salarios.',
    });
  }
};
