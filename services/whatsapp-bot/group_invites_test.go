package main

import (
	"context"
	"go.mau.fi/whatsmeow"
	"go.mau.fi/whatsmeow/types"
	"testing"
)

type inviteProviderFixture struct {
	group    *types.GroupInfo
	joined   bool
	approve  bool
	attempts int
	failure  error
}

func (f *inviteProviderFixture) GetGroupInfoFromLink(context.Context, string) (*types.GroupInfo, error) {
	return f.group, f.failure
}
func (f *inviteProviderFixture) JoinGroupWithLink(context.Context, string) (types.JID, error) {
	f.attempts++
	if !f.approve {
		f.joined = true
	}
	return f.group.JID, nil
}
func (f *inviteProviderFixture) GetJoinedGroups(context.Context) ([]*types.GroupInfo, error) {
	if f.joined {
		return []*types.GroupInfo{f.group}, nil
	}
	return nil, nil
}
func TestGroupInviteRequiresActualMembership(t *testing.T) {
	group := &types.GroupInfo{JID: types.NewJID("12345", types.GroupServer)}
	for _, test := range []struct {
		name             string
		joined, approval bool
		want             string
		joins            int
	}{
		{"already member", true, false, "connected", 0},
		{"immediate join", false, false, "connected", 1},
		{"requires approval", false, true, "awaiting_approval", 1},
	} {
		t.Run(test.name, func(t *testing.T) {
			provider := &inviteProviderFixture{group: group, joined: test.joined, approve: test.approval}
			result := resolveGroupInvite(context.Background(), provider, "ABCDEFGHIJKLMNOPQRSTUV")
			if result.Status != test.want || provider.attempts != test.joins {
				t.Fatalf("status=%s joins=%d", result.Status, provider.attempts)
			}
			if result.Status == "connected" && !result.Joined {
				t.Fatal("connected without real membership")
			}
		})
	}
}
func TestRevokedInviteDoesNotJoin(t *testing.T) {
	provider := &inviteProviderFixture{failure: whatsmeow.ErrInviteLinkRevoked}
	result := resolveGroupInvite(context.Background(), provider, "ABCDEFGHIJKLMNOPQRSTUV")
	if result.Status != "error" || provider.attempts != 0 || result.Joined {
		t.Fatal("revoked invite was accepted")
	}
}
