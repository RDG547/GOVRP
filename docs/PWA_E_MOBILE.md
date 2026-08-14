# GOV.RP como PWA, Android e iOS

O projeto usa uma única aplicação React/Vite em três destinos:

- Web/PWA instalável, com manifesto, service worker e atualização automática.
- Android nativo via Capacitor, com saída AAB para a Play Store.
- iOS nativo via Capacitor, com projeto Xcode para a App Store.

O Capacitor foi usado no lugar de uma segunda implementação em React Native. Assim, o navegador, o PWA e as lojas usam a mesma interface e as mesmas regras de Supabase/Realtime, sem manter dois aplicativos diferentes.

## Web e PWA

```bash
npm install
npm run build
npm run preview
```

O build gera `dist/manifest.webmanifest`, `dist/sw.js` e o cache do Workbox. O convite de instalação aparece quando o navegador dispara `beforeinstallprompt`. Service workers exigem HTTPS em produção (localhost é aceito durante testes).

## Sincronizar os projetos nativos

Sempre que o React ou as dependências nativas mudarem:

```bash
npm run mobile:sync
```

Também é possível sincronizar apenas uma plataforma:

```bash
npm run mobile:sync:android
npm run mobile:sync:ios
```

## Android / AAB

Requisitos do Capacitor 8: Node 22+, Android Studio 2025.2.1+ e Android SDK. Este projeto usa `compileSdk`/`targetSdk` 36 e `minSdk` 24. O build foi validado com JDK 21; configure `JAVA_HOME` para um JDK compatível caso o Java padrão da máquina seja mais novo que o suportado pelo Gradle.

```bash
npm run mobile:open:android
```

No Android Studio, selecione `Build > Generate Signed Bundle / APK > Android App Bundle`, crie ou escolha a chave de upload e gere o bundle `release`.

Após configurar a assinatura no ambiente Gradle, o bundle também pode ser gerado por terminal:

```bash
npm run android:aab
```

A saída fica em `android/app/build/outputs/bundle/release/`. A chave e as senhas de assinatura nunca devem ser commitadas.

## iOS / App Store

O build iOS exige macOS, Xcode 26+ e uma conta Apple Developer. O projeto usa Swift Package Manager.

```bash
npm run mobile:open:ios
```

No Xcode, selecione o time de assinatura do bundle `br.com.govrp.app`, teste em aparelho/simulador e use `Product > Archive` para enviar pelo Organizer ao App Store Connect.

## OAuth e recuperação de senha

O ambiente de produção usa `https://govrp.vercel.app`. Para liberar tanto a web quanto os aplicativos nativos:

1. Abra o projeto no painel do Supabase.
2. Acesse `Authentication > URL Configuration`.
3. Defina `Site URL` como:

```text
https://govrp.vercel.app
```

4. Em `Redirect URLs`, adicione uma entrada exata para cada linha:

```text
https://govrp.vercel.app/auth/callback
https://govrp.vercel.app/update-password
br.com.govrp.app://auth/callback
br.com.govrp.app://update-password
```

5. Salve a configuração e faça um novo deploy na Vercel.

Durante o desenvolvimento local, também pode ser adicionada a entrada `http://localhost:3000/**`. Se os previews da Vercel precisarem autenticar, adicione separadamente o padrão de preview recomendado pelo Supabase, limitado ao slug da sua equipe; não use esse curinga como URL principal de produção.

Android e iOS já registram o scheme `br.com.govrp.app`. No app nativo, o login social abre o navegador seguro do sistema e retorna por deep link; na web, o fluxo retorna para a rota HTTPS da Vercel. A recuperação de senha segue a mesma regra.

Nos painéis dos provedores OAuth, como Google ou Apple, o callback cadastrado continua sendo o endpoint do próprio Supabase:

```text
https://SEU-PROJECT-REF.supabase.co/auth/v1/callback
```

Não cadastre o scheme nativo diretamente como callback do provedor OAuth. Se os templates de e-mail do Supabase tiverem sido personalizados, preserve `{{ .RedirectTo }}` nos links de confirmação/recuperação para que o destino escolhido pelo cliente seja respeitado.

## Identidade visual

O logotipo mestre fica em `resources/brand-world-of-simulators.png`. As variantes de favicon, PWA, Android e iOS são derivadas dele. O ícone `maskable` e o foreground adaptativo preservam uma margem de segurança para que o emblema não seja cortado pelos formatos redondo, squircle e arredondado dos dispositivos.

Depois de trocar os recursos visuais, rode `npm run mobile:sync`. Favicons e ícones de PWA são fortemente armazenados em cache; após o deploy, faça uma atualização forçada no navegador e, se necessário, remova e reinstale o PWA para validar o novo ícone.

## Estado híbrido do RP

Aplique a migration `supabase/migrations/20260814190000_country_rp_state.sql` no ambiente Supabase antes de publicar esta versão. Ela habilita a camada do Brasil, o histórico de eventos e a atualização em tempo real.

Depois da migration:

- o estado real permanece como base de referência;
- eleições presidenciais e partidos dos jogadores substituem a chefia real;
- o motor econômico altera PIB, crescimento e câmbio proporcionalmente à influência dos jogadores;
- leis sancionadas/promulgadas e decretos publicados entram no histórico político;
- todas essas alterações chegam ao globo via Supabase Realtime, sem reload.

Para novos países, adicione uma linha em `country_rp_states`, marque `is_playable = true` e conecte os eventos nacionais ao RPC `apply_country_rp_event`.
