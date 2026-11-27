import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Check, Crown, Sparkles, Lock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/layout/PageHeader';

// Presentation-only catalog. No checkout, subscription API, or entitlement changes.
const plans = [
  {
    id: 'plus',
    name: 'GOVRP+',
    icon: Sparkles,
    price: '9,90',
    description: 'Desbloqueie personalizações exclusivas e aproveite ainda mais sua jornada no GOVRP.',
    accent: 'text-violet-300',
    surface: 'bg-violet-500/10 border-violet-400/30',
    border: 'border-violet-500/30',
    benefits: [
      'Selo exclusivo de apoiador',
      'Temas e personalização da interface',
      'Molduras e avatares exclusivos',
      'Estatísticas pessoais e histórico ampliado',
      'Diário pessoal do personagem',
      'Experiência sem anúncios, caso sejam implementados',
    ],
  },
  {
    id: 'patrono',
    name: 'GOVRP Patrono',
    icon: Crown,
    price: '19,90',
    description: 'Tenha uma experiência premium completa, com benefícios e personalizações ainda mais exclusivos.',
    accent: 'text-amber-300',
    surface: 'bg-amber-500/10 border-amber-400/30',
    border: 'border-amber-500/30',
    benefits: [
      'Todos os benefícios do GOVRP+',
      'Selo exclusivo de Patrono',
      'Personalizações visuais adicionais',
      'Pacotes cosméticos exclusivos',
      'Estatísticas pessoais avançadas',
      'Encontros com o desenvolvedor',
      'Reconhecimento opcional na página de apoiadores',
    ],
  },
];

export default function Plans() {
  return (
    <>
      <Helmet>
        <title>Assinaturas | GOV.RP</title>
        <meta name="description" content="Eleve sua experiência no GOVRP com benefícios exclusivos. Escolha entre GOVRP+ e GOVRP Patrono. Contratação em breve." />
      </Helmet>
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 md:py-20 lg:px-8">
        <PageHeader
          icon={Crown}
          title="Eleve sua experiência"
          gradientText="no GOVRP"
          description="Desbloqueie benefícios exclusivos, personalize sua jornada e aproveite ainda mais o universo do GOVRP. Escolha a assinatura ideal para você!"
          iconColor="text-violet-400"
          centered
        />
        <div className="mb-8 flex items-start gap-3 rounded-xl border border-border bg-muted/30 p-4 sm:p-5">
          <Lock aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div>
            <p className="font-semibold text-foreground">Assinaturas em breve</p>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">As assinaturas ainda não estão disponíveis para contratação. Nenhuma cobrança será realizada neste momento.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {plans.map((plan) => {
            const Icon = plan.icon;
            return (
              <Card key={plan.id} className={`flex h-full flex-col overflow-hidden border bg-card/70 ${plan.border}`}>
                <CardContent className="flex flex-1 flex-col p-6 sm:p-8">
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <span className={`inline-flex rounded-xl border p-3 ${plan.surface}`}>
                      <Icon aria-hidden="true" className={`h-7 w-7 ${plan.accent}`} />
                    </span>
                    <span className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">Em breve</span>
                  </div>
                  <h2 className="text-2xl font-bold text-foreground">{plan.name}</h2>
                  <p className="mt-2 min-h-[3rem] text-sm leading-relaxed text-muted-foreground">{plan.description}</p>
                  <div className="my-6 flex flex-wrap items-baseline gap-1">
                    <span className="text-lg font-medium text-muted-foreground">R$</span>
                    <span className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">{plan.price}</span>
                    <span className="text-sm text-muted-foreground">/mês</span>
                  </div>
                  <div className="border-t border-border pt-5">
                    <h3 className="mb-4 text-sm font-semibold text-foreground">Benefícios previstos</h3>
                    <ul className="space-y-3">
                      {plan.benefits.map((benefit) => (
                        <li key={benefit} className="flex items-start gap-3 text-sm leading-relaxed text-foreground">
                          <Check aria-hidden="true" className={`mt-0.5 h-4 w-4 shrink-0 ${plan.accent}`} />
                          <span>{benefit}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="mt-auto pt-8">
                    <Button type="button" disabled variant="outline" className="w-full min-h-11">
                      <Lock aria-hidden="true" className="mr-2 h-4 w-4" /> Assinatura indisponível
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
