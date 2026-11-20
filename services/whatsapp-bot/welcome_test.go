package main

import (
	"strings"
	"testing"

	"go.mau.fi/whatsmeow/types"
)

func TestWelcomeGroupEligibility(t *testing.T) {
	self := types.NewJID("5511999000000", types.DefaultUserServer)
	member := types.NewJID("5511888111111", types.DefaultUserServer)
	second := types.NewJID("5511777222222", types.DefaultUserServer)
	group := types.NewJID("120363289786230845", types.GroupServer)
	joined := []types.JID{member, self, member, group, second}

	allowed := eligibleWelcomeMembers(true, true, true, joined, self)
	if len(allowed) != 2 || allowed[0] != member || allowed[1] != second {
		t.Fatalf("expected only new, unique non-bot members, got %#v", allowed)
	}
	for _, test := range []struct {
		name string
		on, allow, official bool
	}{
		{"bot paused", false, true, true},
		{"group not enabled", true, false, true},
		{"not the official GOVRP group", true, true, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := eligibleWelcomeMembers(test.on, test.allow, test.official, joined, self); len(got) > 0 {
				t.Fatalf("unauthorized welcome: %#v", got)
			}
		})
	}
}

func TestWelcomePersonalizationAndPermissions(t *testing.T) {
	alice := types.NewJID("5511888111111", types.DefaultUserServer)
	bob := types.NewJID("5511777222222", types.DefaultUserServer)
	msg, err := welcomeNewMembersMessage([]types.JID{alice, bob, alice}, "!")
	if err != nil {
		t.Fatal(err)
	}
	ext := msg.GetExtendedTextMessage()
	if ext == nil || msg.GetConversation() != "" {
		t.Fatal("a real WhatsApp mention requires an ExtendedTextMessage")
	}
	text := ext.GetText()
	for _, part := range []string{
		"Boas-vindas ao GOVRP", "@5511888111111", "@5511777222222",
		"crie seu cidadão", "!ajuda", "!governo", "!eleicoes", "!partidos",
		"https://govrp.vercel.app", "Convide amigos",
	} {
		if !strings.Contains(text, part) {
			t.Errorf("missing important onboarding information %q", part)
		}
	}
	if strings.Contains(text, "@todos") || strings.Contains(text, "@everyone") {
		t.Fatal("a personalized welcome must never tag every group member")
	}
	ids := ext.GetContextInfo().GetMentionedJID()
	if len(ids) != 2 || ids[0] != alice.String() || ids[1] != bob.String() {
		t.Fatalf("welcome must tag ONLY new members, got %#v", ids)
	}
	custom, err := welcomeNewMembersMessage([]types.JID{alice}, "/")
	if err != nil || !strings.Contains(custom.GetExtendedTextMessage().GetText(), "/ajuda") {
		t.Fatal("welcome message must honor the configured prefix")
	}
	if _, err := welcomeNewMembersMessage(nil, "!"); err == nil {
		t.Fatal("empty group change must not generate an announcement")
	}
}

func TestDetailedHelpHasRealExplanations(t *testing.T) {
	help := helpMessage("!")
	for _, expected := range []string{
		"*!deputados* — Mostra informações dos deputados em exercício",
		"*!senadores* — Mostra informações dos senadores em exercício",
		"*!eleicoes* — Veja o histórico numerado das eleições",
		"!eleicoes 2",
		"*!governo* — Confira a formação governamental:",
		"Vice-Presidente, ministros de Estado e PGR",
		"*!vincular* CÓDIGO — Vincule seu WhatsApp",
		"*!noticias* — Veja as cinco notícias",
		"*!economia* — Confira crescimento econômico",
		"*!ajuda* — Veja todos os comandos",
	} {
		if !strings.Contains(help, expected) {
			t.Errorf("missing command description %q", expected)
		}
	}
	if !strings.Contains(helpMessage("/"), "/eleicoes 2") ||
		strings.Contains(helpMessage("/"), "!eleicoes 2") {
		t.Fatal("an example in help must use the configured command prefix")
	}
}
