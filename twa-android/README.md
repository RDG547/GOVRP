# GOVRP — Trusted Web Activity (Android / Google Play)

Este é o **aplicativo Android do GOVRP com atualizações web automáticas**. O navegador Android exibe a PWA existente em `https://govrp.vercel.app/` como **Trusted Web Activity**.

- Nome de exibição: `GOV.RP`
- Package/applicationId: `com.worldofsimulators.app`
- Versão de correção: `1.0.1`, versionCode `2`
- minSdk 24, compileSdk/targetSdk 36
- Android Browser Helper 2.7.4
- Chave de assinatura da Google Play **não fica no repositório**.

## Mudanças do site × mudanças do Android

Mudanças de HTML, CSS, React e funcionalidades na Vercel são entregues pelo próprio domínio e PWA, sem gerar outro AAB. Atualizar o ícone instalado, launcher nativo, pacote, versão, permissões, assinatura, SDK e bibliotecas Android **exige novo AAB**. Não use `server.url` do Capacitor: este projeto TWA é independente do projeto `android/` existente.

## Build

A GitHub Action `Android GOVRP - Trusted Web Activity` faz build de:
- `GOVRP-v1.0.1-unsigned.aab` — assinar localmente com `jarsigner` + sua keystore de upload antes de enviar à Play Store.
- `GOVRP-v1.0.1-unsigned.apk` — assinar com `apksigner` + mesma chave, após ZIP align quando necessário.
- `GOVRP-v1.0.1-debug.apk` — aplicativo de debug, **não enviar à Play Store e não usar para verificar TWA**, pois possui certificado de debug diferente.
- Ferramenta `apksigner` do Android Build Tools, para assinatura local do APK.

Ao gerar diretamente em Android Studio:
```bash
# Instale Android SDK API 36, JDK 21; o wrapper Gradle está em ../android/
mkdir -p app/src/main/res/drawable
cp ../public/icon-512x512.png app/src/main/res/drawable/ic_launcher.png
../android/gradlew -p . :app:bundleRelease :app:assembleRelease
```

## Chaves e verificação de domínio

O site contém `public/.well-known/assetlinks.json` com o SHA-256 **do certificado de upload inicial**. Isso habilita a TWA para APKs assinados com essa chave, instalados fora do Google Play.

**MUITO IMPORTANTE**: no Google Play App Signing, a Google normalmente assina APKs distribuídos com **outro certificado**. Depois de cadastrar o AAB no Play Console:
1. Abra **Testar e lançar > Configuração > Integridade do app / Assinatura do app** (menus podem mudar).
2. Copie a impressão digital **SHA-256 do certificado de assinatura do app** (não confundir com certificado de upload).
3. Acrescente essa SHA-256 à lista `sha256_cert_fingerprints` em `public/.well-known/assetlinks.json`, **mantendo** a atual se desejar compatibilidade com o APK externo.
4. Publique a mudança na Vercel e teste no aparelho com a versão instalada pela Play Store. Sem isso, a barra de navegador pode aparecer.

Não guarde a senha nem a keystore em GitHub, na pasta web ou em variáveis de ambiente públicas. Salve cópias seguras offline.

## Publicação e conformidade

1. AAB assinado + nome `GOV.RP` na Play Console. O packageId é permanente após a primeira publicação.
2. Classificação indicativa, política de privacidade, declaração de segurança dos dados, exclusão da conta e anúncios, conforme aplicável.
3. GOVRP é um **jogo/simulação fictícia** e não presta serviços do governo brasileiro. A descrição não deve sugerir afiliação oficial.
4. Teste login, OAuth, abertura de links, compras, downloads, botão Voltar, modo offline e PWA; valide em teste interno/fechado antes de liberar.
5. Para futuras versões nativas, incremente `versionCode` e `versionName` em `app/build.gradle` e produza um novo AAB.

### Verificação

```bash
node tools/test-android-twa-contract.mjs
```

App-web: https://govrp.vercel.app/
