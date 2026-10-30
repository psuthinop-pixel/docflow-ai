// Members section of the Settings page: who can see and edit the current property
window.MembersSection = {
    orgId: null,
    members: [],
    loading: false,
    error: null,
    invite: null,     // { name, email, temporary_password } shown once after an account is created

    myRole() {
        const org = (App.organizations || []).find(o => (o._id || o.id) === App.currentCompany);
        return org ? org.role : null;
    },

    meId() {
        return App.currentUser && (App.currentUser.id || App.currentUser._id);
    },

    // Mirrors the server rules in backend/src/routes/members.ts
    canManage(targetRole) {
        const me = this.myRole();
        if (me === 'owner') return true;
        return me === 'admin' && targetRole !== 'owner';
    },

    render(companyId) {
        // Settings re-renders on every property edit; refetch only for a new property or after 30s
        if (this.orgId !== companyId) {
            this.orgId = companyId;
            this.members = [];
            this.invite = null;
            this.loadedAt = 0;
        }
        if (Date.now() - (this.loadedAt || 0) > 30000) this.load();
        return `
      <div class="settings-section" id="membersSection">${this.renderBody()}</div>`;
    },

    renderBody() {
        const me = this.myRole();
        const canAdd = me === 'owner' || me === 'admin';
        const roleHelp = 'Owner: everything, including other owners · Admin: edit the property, approve expenses, manage members · Member: upload receipts and edit any not yet approved';

        let list;
        if (this.error) {
            list = `<div style="font-size:0.85rem;color:var(--red)">⚠️ Couldn't load members: ${esc(this.error)}
              <button class="btn btn-secondary btn-sm" style="margin-left:8px" onclick="MembersSection.load(true)">↻ Retry</button></div>`;
        } else if (this.loading && !this.members.length) {
            list = [1, 2].map(() => '<div class="skeleton" style="height:44px;margin-bottom:8px"></div>').join('');
        } else {
            list = `<div class="settings-rows">${this.members.map(m => this.renderMember(m)).join('')}</div>`;
        }

        return `
        <div class="settings-title">👥 Members</div>
        <div class="settings-subtitle" title="${roleHelp}">People who can see this property's receipts. ${roleHelp}.</div>

        ${this.invite ? this.renderInvite() : ''}
        ${list}

        ${canAdd ? `
        <form class="member-add" onsubmit="event.preventDefault();MembersSection.add()">
          <input class="form-input" id="memberEmail" type="email" placeholder="Email" required autocomplete="off">
          <input class="form-input" id="memberName" placeholder="Name (for new accounts)" autocomplete="off">
          <select class="form-input" id="memberRole" aria-label="Role">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            ${me === 'owner' ? '<option value="owner">Owner</option>' : ''}
          </select>
          <button class="btn btn-primary btn-sm" type="submit" id="memberAddBtn" style="white-space:nowrap">+ Add member</button>
        </form>
        <p style="font-size:0.75rem;color:var(--text-muted);margin-top:8px">
          If the email has no DocFlow account yet, one is created with a temporary password for you to pass on.
        </p>` : ''}`;
    },

    renderMember(m) {
        const isMe = m.user_id === this.meId();
        const manage = !isMe && this.canManage(m.role);
        const roleSel = manage ? `
          <select class="form-input member-role" aria-label="Role for ${esc(m.name)}" onchange="MembersSection.setRole('${esc(m.user_id)}', this.value, this)">
            ${['member', 'admin', 'owner']
                .filter(r => r !== 'owner' || this.myRole() === 'owner')
                .map(r => `<option value="${r}" ${r === m.role ? 'selected' : ''}>${r[0].toUpperCase() + r.slice(1)}</option>`).join('')}
          </select>`
            : `<span class="badge ${m.role === 'owner' ? 'badge-approved' : m.role === 'admin' ? 'badge-info' : 'badge-draft'}">${esc(m.role)}</span>`;
        const action = isMe
            ? `<button class="btn btn-ghost btn-sm" onclick="MembersSection.remove('${esc(m.user_id)}', true)">Leave</button>`
            : manage ? `<button class="btn btn-ghost btn-sm" style="color:var(--red)" onclick="MembersSection.remove('${esc(m.user_id)}')" aria-label="Remove ${esc(m.name)}">Remove</button>` : '';
        return `
          <div class="settings-row member-row">
            <div style="display:flex;align-items:center;gap:10px;min-width:0">
              <div class="topbar-avatar" style="width:32px;height:32px;font-size:0.8rem;flex-shrink:0">${esc((m.name || m.email).charAt(0).toUpperCase())}</div>
              <div style="min-width:0">
                <div style="color:var(--text-primary);font-weight:600">${esc(m.name)}${isMe ? ' <span style="color:var(--text-muted);font-weight:400">(you)</span>' : ''}</div>
                <div style="font-size:0.75rem;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis">${esc(m.email)}</div>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px">${roleSel}${action}</div>
          </div>`;
    },

    renderInvite() {
        const i = this.invite;
        return `
        <div class="invite-box" role="status">
          <div style="font-weight:700;margin-bottom:6px">✅ Account created for ${esc(i.name)}</div>
          <div style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:10px">
            Send these sign-in details privately (e.g. LINE). The password is shown only once. Ask them to change it in Settings → Account.
          </div>
          <div class="invite-creds">
            <div><span>Sign in at</span><code>${esc(location.origin)}</code></div>
            <div><span>Email</span><code>${esc(i.email)}</code></div>
            <div><span>Temporary password</span><code>${esc(i.temporary_password)}</code></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn btn-primary btn-sm" onclick="MembersSection.copyInvite()">📋 Copy message</button>
            <button class="btn btn-ghost btn-sm" onclick="MembersSection.dismissInvite()">Done</button>
          </div>
        </div>`;
    },

    refresh() {
        const el = document.getElementById('membersSection');
        if (el) el.innerHTML = this.renderBody();
    },

    async load(force = false) {
        if (this.loading && !force) return;
        const orgId = this.orgId;
        this.loading = true;
        this.error = null;
        this.refresh();
        try {
            const members = await MemberApi.list(orgId);
            if (orgId === this.orgId) { this.members = members; this.loadedAt = Date.now(); }
        } catch (error) {
            this.error = error.message;
        } finally {
            this.loading = false;
            this.refresh();
        }
    },

    async add() {
        const email = document.getElementById('memberEmail').value.trim();
        const name = document.getElementById('memberName').value.trim();
        const role = document.getElementById('memberRole').value;
        const btn = document.getElementById('memberAddBtn');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ Adding...'; }
        try {
            const m = await MemberApi.add(this.orgId, { email, name, role });
            this.invite = m.temporary_password ? m : null;
            if (!m.temporary_password) App.showToast('success', `✅ ${m.name} added as ${m.role}`);
            await this.load(true);
        } catch (error) {
            App.showToast('error', '❌ ' + error.message, 4000);
            if (btn) { btn.disabled = false; btn.textContent = '+ Add member'; }
        }
    },

    async setRole(userId, role, select) {
        const m = this.members.find(x => x.user_id === userId);
        try {
            await MemberApi.setRole(this.orgId, userId, role);
            App.showToast('success', `✅ ${m ? m.name : 'Member'} is now ${role}`);
            await this.load(true);
        } catch (error) {
            App.showToast('error', '❌ ' + error.message, 4000);
            if (select && m) select.value = m.role;
        }
    },

    async remove(userId, self = false) {
        const m = this.members.find(x => x.user_id === userId);
        const org = (App.organizations || []).find(o => (o._id || o.id) === this.orgId);
        const orgName = org ? org.organization_name : 'this property';
        const question = self
            ? `Leave ${orgName}? You will lose access to its receipts until someone adds you back.`
            : `Remove ${m ? m.name : 'this member'} from ${orgName}? They keep their account but lose access to this property.`;
        if (!confirm(question)) return;
        try {
            await MemberApi.remove(this.orgId, userId);
            if (self) {
                App.showToast('success', `You left ${orgName}`);
                await App.refreshOrganizations();
                localStorage.removeItem('docflow-company');
                App.currentCompany = null;
                App.navigate('select-organization');
                return;
            }
            App.showToast('success', `${m ? m.name : 'Member'} removed`);
            await this.load(true);
        } catch (error) {
            App.showToast('error', '❌ ' + error.message, 4000);
        }
    },

    async copyInvite() {
        const i = this.invite;
        const text = `You've been added to DocFlow AI.\nSign in at ${location.origin}\nEmail: ${i.email}\nTemporary password: ${i.temporary_password}\nPlease change it in Settings → Account after signing in.`;
        try {
            await navigator.clipboard.writeText(text);
            App.showToast('success', '📋 Copied, ready to paste into LINE');
        } catch {
            App.showToast('error', 'Copy failed: select the details and copy them manually', 4000);
        }
    },

    dismissInvite() {
        this.invite = null;
        this.refresh();
    },
};
