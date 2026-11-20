package main

import (
	"errors"
	"log"
	"strings"
	"time"

	"go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

// Only genuine join events from enabled, authorized OFFICIAL GOVRP groups
// receive welcomes. Never use the list returned during startup to greet everyone.
func eligibleWelcomeMembers(enabled, allowed, official bool, joins []types.JID, self types.JID) []types.JID {
	if !enabled || !allowed || !official {
		return nil
	}
	seen := make(map[string]bool)
	eligible := make([]types.JID, 0, len(joins))
	for _, user := range joins {
		if user.User == "" || (user.Server != types.DefaultUserServer && user.Server != types.HiddenUserServer) {
			continue
		}
		normalized := user.ToNonAD()
		if normalized == self.ToNonAD() || seen[normalized.String()] {
			continue
		}
		seen[normalized.String()] = true
		eligible = append(eligible, normalized)
	}
	return eligible
}

// Use actual targeted mentions in ContextInfo; no @todos or full-group ping.
func welcomeNewMembersMessage(members []types.JID, prefix string) (*waE2E.Message, error) {
	seen := map[string]bool{}
	names := []string{}
	ids := []string{}
	for _, member := range members {
		if member.User == "" || (member.Server != types.DefaultUserServer && member.Server != types.HiddenUserServer) {
			continue
		}
		normalized := member.ToNonAD()
		id := normalized.String()
		if seen[id] {
			continue
		}
		seen[id] = true
		names = append(names, "@"+normalized.User)
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return nil, errors.New("nenhum novo integrante para receber boas-vindas")
	}
	if prefix != "!" && prefix != "/" {
		prefix = "!"
	}
	body := "👋 *Boas-vindas ao GOVRP!* 🏛️\n\n" +
		strings.Join(names, ", ") + ", que bom ter você com a gente! 🎉\n\n" +
		"🇧🇷 *Como funciona o RP?*\n" +
		"O GOVRP é um universo de simulação política e econômica: crie seu cidadão, participe de partidos, acompanhe eleições, dispute cargos e ajude a escrever a história do país.\n\n" +
		"🤖 *Nosso bot pode ajudar:*\n" +
		"• " + prefix + "ajuda — conheça todos os comandos.\n" +
		"• " + prefix + "governo — consulte a formação do governo atual.\n" +
		"• " + prefix + "eleicoes — acompanhe as eleições do RP.\n" +
		"• " + prefix + "partidos — descubra os partidos e seus integrantes.\n\n" +
		"🌐 *Comece a jogar:* " + siteURL + "\n\n" +
		"🤝 Gostou da proposta? Convide amigos para participar! Quanto mais gente, mais dinâmica e divertida fica a simulação. 💙"
	return &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{
		Text:        proto.String(body),
		ContextInfo: &waE2E.ContextInfo{MentionedJID: ids},
	}}, nil
}

func (b *Bot) onGroupInfo(event *events.GroupInfo) {
	if event == nil || event.JID.Server != types.GroupServer || len(event.Join) == 0 ||
		b.wa == nil || !b.wa.IsLoggedIn() {
		return
	}
	group := event.JID.String()
	b.mu.RLock()
	enabled := b.settings.Enabled
	allowed := b.groups[group]
	official := b.officialGroups[group]
	prefix := b.settings.Prefix
	b.mu.RUnlock()

	var self types.JID
	if b.wa.Store != nil && b.wa.Store.ID != nil {
		self = b.wa.Store.ID.ToNonAD()
	}
	joiners := eligibleWelcomeMembers(enabled, allowed, official, event.Join, self)
	if len(joiners) == 0 {
		return
	}

	// WhatsApp may replay participant updates on reconnection. De-duplicate
	// by group and member, without suppressing welcomes to different users.
	b.welcomeMu.Lock()
	now := time.Now()
	if b.welcomeSent == nil {
		b.welcomeSent = map[string]time.Time{}
	}
	fresh := make([]types.JID, 0, len(joiners))
	for _, member := range joiners {
		key := group + "/" + member.String()
		if previous, found := b.welcomeSent[key]; found && now.Sub(previous) < 6*time.Hour {
			continue
		}
		b.welcomeSent[key] = now
		fresh = append(fresh, member)
	}
	if len(b.welcomeSent) > 1500 {
		for key, seenAt := range b.welcomeSent {
			if now.Sub(seenAt) >= 6*time.Hour {
				delete(b.welcomeSent, key)
			}
		}
	}
	b.welcomeMu.Unlock()
	if len(fresh) == 0 {
		return
	}

	payload, err := welcomeNewMembersMessage(fresh, prefix)
	if err != nil {
		log.Printf("welcome message: %v", err)
		return
	}
	go func() {
		if _, err := b.sendPrepared(event.JID, payload); err != nil {
			log.Printf("welcome to official group %s failed: %v", group, err)
		}
	}()
}
