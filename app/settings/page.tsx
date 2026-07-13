"use client"

import { useState } from "react"
import { Panel, PanelHeader, PageHeader } from "@/components/ui-kit"

function Toggle({ defaultOn }: { defaultOn?: boolean }) {
  const [on, setOn] = useState(!!defaultOn)
  return (
    <button
      onClick={() => setOn((v) => !v)}
      role="switch"
      aria-checked={on}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-primary" : "bg-secondary"}`}
    >
      <span
        className={`absolute top-0.5 size-5 rounded-full bg-background transition-transform ${
          on ? "translate-x-[22px]" : "translate-x-0.5"
        }`}
      />
    </button>
  )
}

const orgFields = [
  { label: "Organization", value: "Meridian Labs" },
  { label: "Treasury wallet", value: "0x8F3a...D29c" },
  { label: "Settlement network", value: "Base L2 · USDC" },
  { label: "Account tier", value: "Institutional" },
]

const prefs = [
  { label: "Auto-approve AAA requests", desc: "Instantly settle credit requests from AAA-rated agents.", on: true },
  { label: "Default event alerts", desc: "Notify treasury on any counterparty default event.", on: true },
  { label: "Weekly risk digest", desc: "Emailed portfolio risk summary every Monday.", on: false },
  { label: "Require 2-of-3 multisig", desc: "Credit lines above $50K need multisig approval.", on: true },
]

export default function SettingsPage() {
  return (
    <div>
      <PageHeader eyebrow="Settings" title="Account & policy" description="Manage organization details and credit policy automation." />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Organization" description="Institutional account details" />
          <div className="divide-y divide-border">
            {orgFields.map((f) => (
              <div key={f.label} className="flex items-center justify-between px-5 py-4">
                <span className="text-sm text-muted-foreground">{f.label}</span>
                <span className="font-mono text-sm text-card-foreground">{f.value}</span>
              </div>
            ))}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Credit policy" description="Automation & risk controls" />
          <div className="divide-y divide-border">
            {prefs.map((p) => (
              <div key={p.label} className="flex items-start justify-between gap-4 px-5 py-4">
                <div>
                  <p className="text-sm font-medium text-card-foreground">{p.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{p.desc}</p>
                </div>
                <Toggle defaultOn={p.on} />
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button className="rounded-md border border-border bg-secondary/50 px-4 py-2 text-sm font-medium text-foreground hover:bg-secondary">
          Discard
        </button>
        <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
          Save changes
        </button>
      </div>
    </div>
  )
}
