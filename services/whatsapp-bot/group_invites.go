package main

import (
	"context"
	"errors"
	"log"
	"time"

	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
)

func memberOf(groups []*types.GroupInfo, jid types.JID) bool {
	for _, group := range groups {
		if group.JID == jid {
			return true
		}
	}
	return false
}
func inviteFailure(err error) string {
	if errors.Is(err, whatsmeow.ErrInviteLinkRevoked) {
		return "Este convite foi revogado. Gere um novo link no WhatsApp."
	}
	if errors.Is(err, whatsmeow.ErrInviteLinkInvalid) {
		return "O link de convite não é válido."
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "O WhatsApp não respondeu a tempo. Tente novamente."
	}
	return "Não foi possível validar o vínculo no WhatsApp. Verifique o convite e a conexão do bot."
}

type groupInviteProvider interface {
	GetGroupInfoFromLink(context.Context, string) (*types.GroupInfo, error)
	JoinGroupWithLink(context.Context, string) (types.JID, error)
	GetJoinedGroups(context.Context) ([]*types.GroupInfo, error)
}
type groupInviteResult struct {
	JID                   any
	Name, Status, Problem string
	Joined                bool
}

func resolveGroupInvite(ctx context.Context, provider groupInviteProvider, code string) groupInviteResult {
	result := groupInviteResult{Status: "error"}
	group, err := provider.GetGroupInfoFromLink(ctx, code)
	if err != nil {
		result.Problem = inviteFailure(err)
		return result
	}
	result.JID = group.JID.String()
	result.Name = group.Name
	groups, err := provider.GetJoinedGroups(ctx)
	if err != nil {
		result.Problem = inviteFailure(err)
		return result
	}
	result.Joined = memberOf(groups, group.JID)
	if !result.Joined {
		_, err = provider.JoinGroupWithLink(ctx, code)
		if err != nil {
			result.Problem = inviteFailure(err)
			return result
		}
		// A successful join call may only submit an approval request. Confirm
		// participation against the provider's actual list, never the invite alone.
		groups, err = provider.GetJoinedGroups(ctx)
		if err != nil {
			result.Problem = inviteFailure(err)
			return result
		}
		result.Joined = memberOf(groups, group.JID)
	}
	if result.Joined {
		result.Status = "connected"
	} else {
		result.Status = "awaiting_approval"
		result.Problem = "Entrada solicitada. Aguarde a aprovação de um administrador do grupo."
	}
	return result
}
func (b *Bot) processGroupInvites() {
	if !b.wa.IsConnected() || !b.wa.IsLoggedIn() {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	var requests []struct {
		ID    string `json:"id"`
		Code  string `json:"invite_code"`
		Lease string `json:"lease_id"`
	}
	if err := b.api.rpc(ctx, "bot_claim_whatsapp_group_invites", map[string]any{}, &requests); err != nil {
		log.Print("group invitations: unable to consult pending requests")
		return
	}
	for _, request := range requests {
		result := resolveGroupInvite(ctx, b.wa, request.Code)
		if err := b.api.rpc(ctx, "bot_finish_whatsapp_group_invite", map[string]any{"p_id": request.ID, "p_lease": request.Lease, "p_jid": result.JID, "p_name": result.Name, "p_joined": result.Joined, "p_status": result.Status, "p_error": result.Problem}, nil); err != nil {
			log.Print("group invitations: unable to persist participation check")
		}
	}
}
