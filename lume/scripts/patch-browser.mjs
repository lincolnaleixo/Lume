#!/usr/bin/env node
// SPDX-License-Identifier: MPL-2.0
// Small, exact-match edits. Fail on upstream drift instead of guessing.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const patches=[
  ['components/brave_wallet/common/buildflags/buildflags.gni','enable_brave_wallet = !is_brave_origin_branded','enable_brave_wallet = false  # Lume: no cryptocurrency wallet.'],
  ['components/brave_rewards/core/buildflags/buildflags.gni','enable_brave_rewards = !is_brave_origin_branded','enable_brave_rewards = false  # Lume: no token rewards.'],
  ['components/brave_ads/buildflags/buildflags.gni','enable_brave_ads = !is_brave_origin_branded','enable_brave_ads = false  # Lume: no Brave advertising subsystem.'],
  ['components/brave_sync/features.cc','BASE_FEATURE(kBraveSync, base::FEATURE_ENABLED_BY_DEFAULT);','BASE_FEATURE(kBraveSync, base::FEATURE_DISABLED_BY_DEFAULT);'],
  ['components/brave_sync/features.cc','BASE_FEATURE(kBraveSyncDefaultPasswords,\n             base::FEATURE_ENABLED_BY_DEFAULT);','BASE_FEATURE(kBraveSyncDefaultPasswords,\n             base::FEATURE_DISABLED_BY_DEFAULT);'],
  ['components/brave_sync/BUILD.gn','brave_sync_endpoint = "https://sync-v2.brave.com/v2"','brave_sync_endpoint = "https://sync-disabled.invalid/v2"'],
  ['build/config.gni','enable_sparkle = !is_component_build && is_mac','enable_sparkle = false  # Lume: no upstream binary updates.'],
  ['build/config.gni','brave_product_name = "brave"','brave_product_name = "lume"'],
  ['build/config.gni','"BraveSoftware/Brave-$_product_brand$brave_product_dir_name_suffix"','"Lume/Lume$brave_product_dir_name_suffix"'],
  ['app/theme/brave/BRANDING','COMPANY_FULLNAME=Brave Software, Inc.','COMPANY_FULLNAME=Lume Contributors'],
  ['app/theme/brave/BRANDING','COMPANY_SHORTNAME=Brave Software','COMPANY_SHORTNAME=Lume'],
  ['app/theme/brave/BRANDING','PRODUCT_FULLNAME=Brave Browser','PRODUCT_FULLNAME=Lume'],
  ['app/theme/brave/BRANDING','PRODUCT_SHORTNAME=Brave','PRODUCT_SHORTNAME=Lume'],
  ['app/theme/brave/BRANDING','PRODUCT_INSTALLER_FULLNAME=Brave Installer','PRODUCT_INSTALLER_FULLNAME=Lume Installer'],
  ['app/theme/brave/BRANDING','PRODUCT_INSTALLER_SHORTNAME=Brave Installer','PRODUCT_INSTALLER_SHORTNAME=Lume Installer'],
  ['app/theme/brave/BRANDING','MAC_BUNDLE_ID=com.brave.Browser','MAC_BUNDLE_ID=org.lume.browser'],
  ['app/theme/brave/BRANDING','MAC_TEAM_ID=KL8N8XSYF4\n','MAC_TEAM_ID=\n'],
];
const files=new Map();
for(const [path,before,after] of patches){
  let text=files.get(path)??await readFile(root+path,'utf8');
  if(text.includes(after)){files.set(path,text);continue;}
  if(text.split(before).length!==2)throw new Error(`Upstream drift at ${path}: ${before}`);
  files.set(path,text.replace(before,after));
}
for(const [path,text] of files)await writeFile(root+path,text);
console.log(`Applied Lume policies to ${files.size} source files. Native compilation remains required.`);
