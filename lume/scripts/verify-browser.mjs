#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const checks=[
 ['components/brave_wallet/common/buildflags/buildflags.gni','enable_brave_wallet = false'],
 ['components/brave_rewards/core/buildflags/buildflags.gni','enable_brave_rewards = false'],
 ['components/brave_ads/buildflags/buildflags.gni','enable_brave_ads = false'],
 ['components/brave_sync/features.cc','BASE_FEATURE(kBraveSync, base::FEATURE_DISABLED_BY_DEFAULT);'],
 ['components/brave_sync/BUILD.gn','https://sync-disabled.invalid/v2'],
 ['app/theme/brave/BRANDING','PRODUCT_FULLNAME=Lume'],
 ['app/theme/brave/BRANDING','MAC_BUNDLE_ID=org.lume.browser'],
 ['app/theme/brave/BRANDING','MAC_TEAM_ID=\n'],
 ['build/config.gni','enable_sparkle = false'],
 ['build/config.gni','"Lume/Lume$brave_product_dir_name_suffix"'],
];
for(const [path,expected] of checks){if(!(await readFile(root+path,'utf8')).includes(expected))throw new Error(`Missing policy: ${path} / ${expected}`);}
const paths=execFileSync('git',['ls-files','lume'],{cwd:root,encoding:'utf8'}).split('\n');
for(const path of paths){if(/(^|\/)(\.local|\.dev.vars[^/]*|pairing-[^/]*\.json|owner-recovery\.json)(\/|$)/.test(path))throw new Error(`Private file tracked: ${path}`);}
console.log(`${checks.length} source policy checks passed. This is NOT a native build or security certification.`);
