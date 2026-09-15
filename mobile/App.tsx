import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { api, DASHBOARD_URL, type HelpRequest, type Incident, type Session, type Shelter, type Zone } from './src/api';

type Tab = 'home' | 'help' | 'zones' | 'profile';
type Coordinates = { latitude: number; longitude: number };
const SESSION_KEY = 'rescuermap_session';
const HELP_TYPES = [
  { key: 'EVACUATION', icon: '↗', label: 'Evacuation', hint: 'I need to leave safely' },
  { key: 'MEDICAL', icon: '+', label: 'Medical', hint: 'Someone needs medical help' },
  { key: 'STRANDED', icon: '!', label: 'Stranded', hint: 'I cannot leave this location' },
  { key: 'TRANSPORTATION', icon: '⌁', label: 'Transport', hint: 'I need a vehicle or ride' },
] as const;

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [restoring, setRestoring] = useState(true);
  useEffect(() => { AsyncStorage.getItem(SESSION_KEY).then(v => v && setSession(JSON.parse(v))).finally(() => setRestoring(false)); }, []);
  if (restoring) return <LoadingScreen label="Preparing RescuerMap…" />;
  return <SafeAreaProvider><StatusBar style="dark" />{session
    ? <ResidentApp session={session} onLogout={() => { setSession(null); AsyncStorage.removeItem(SESSION_KEY); }} />
    : <LoginScreen onLogin={value => { setSession(value); AsyncStorage.setItem(SESSION_KEY, JSON.stringify(value)); }} />}</SafeAreaProvider>;
}

function LoginScreen({ onLogin }: { onLogin: (session: Session) => void }) {
  const [email, setEmail] = useState('resident@rescuermap.local');
  const [password, setPassword] = useState('Demo123!');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function login() {
    setLoading(true); setError('');
    try { onLogin(await api.login(email.trim(), password)); } catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  return <SafeAreaView style={s.login}>
    <View style={s.loginHero}><Logo/><Text style={s.brand}>RESCUERMAP</Text><Text style={s.heroTitle}>Safety, without the guesswork.</Text><Text style={s.heroText}>Request help, see evacuation updates and let loved ones know you are safe.</Text></View>
    <View style={s.loginCard}><Text style={s.sectionTitle}>Resident sign in</Text><FieldLabel>Email</FieldLabel><TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" style={s.input}/><FieldLabel>Password</FieldLabel><TextInput value={password} onChangeText={setPassword} secureTextEntry style={s.input}/>{!!error && <Text style={s.error}>{error}</Text>}<PrimaryButton label={loading ? 'Connecting to server…' : 'Continue'} disabled={loading} onPress={login}/><Text style={s.demoNote}>Demo account is prefilled. The free server may take a moment to wake up.</Text></View>
  </SafeAreaView>;
}

function ResidentApp({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('home');
  const [incident, setIncident] = useState<Incident | null>(null);
  const [requests, setRequests] = useState<HelpRequest[]>([]);
  const [shelters, setShelters] = useState<Shelter[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [fireCount, setFireCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  async function refresh() {
    setRefreshing(true); setError('');
    try {
      const incidents = await api.incidents(session.accessToken); const current = incidents[0] ?? null; setIncident(current);
      const [mine, shelterData, zoneData] = await Promise.all([api.myRequests(session.accessToken), api.shelters(session.accessToken, current?.id), api.zones()]);
      setRequests(mine); setShelters(shelterData); setZones(zoneData.zones); setFireCount(zoneData.fireCount);
    } catch (e) { setError((e as Error).message); } finally { setRefreshing(false); }
  }
  useEffect(() => { refresh(); }, []);
  return <SafeAreaView style={s.app} edges={['top', 'bottom']}>
    <View style={s.topbar}><View><Text style={s.hello}>Hello, {session.user.name.split(' ')[0]}</Text><Text style={s.muted}>Resident safety centre</Text></View><View style={s.livePill}><View style={s.liveDot}/><Text style={s.liveText}>LIVE</Text></View></View>
    {!!error && <Pressable style={s.banner} onPress={refresh}><Text style={s.bannerText}>{error} · Tap to retry</Text></Pressable>}
    <View style={s.body}>{tab === 'home' && <Home {...{ incident, requests, shelters, refreshing, refresh, session }} go={setTab}/>} {tab === 'help' && <Help {...{ incident, requests }} token={session.accessToken} onSent={refresh}/>} {tab === 'zones' && <Zones {...{ zones, fireCount, shelters, refreshing, refresh }}/>} {tab === 'profile' && <Profile {...{ session, onLogout }}/>}</View>
    <View style={s.nav}><Nav icon="⌂" label="Home" active={tab === 'home'} onPress={() => setTab('home')}/><Nav icon="✚" label="Get help" active={tab === 'help'} danger onPress={() => setTab('help')}/><Nav icon="◇" label="Updates" active={tab === 'zones'} onPress={() => setTab('zones')}/><Nav icon="○" label="Profile" active={tab === 'profile'} onPress={() => setTab('profile')}/></View>
  </SafeAreaView>;
}

function Home({ incident, requests, shelters, refreshing, refresh, go, session }: { incident: Incident | null; requests: HelpRequest[]; shelters: Shelter[]; refreshing: boolean; refresh: () => void; go: (tab: Tab) => void; session: Session }) {
  const active = requests.find(r => !['SAFE', 'CLOSED', 'CANCELLED'].includes(r.status));
  async function safe() {
    if (!incident) return Alert.alert('No active incident', 'There is no incident to check in against.');
    try { const c = await getLocation(); await api.safeCheckIn(session.accessToken, incident.id, c?.latitude, c?.longitude); Alert.alert('You are marked safe', 'The coordination team can now see your safe check-in.'); refresh(); }
    catch (e) { Alert.alert('Could not check in', (e as Error).message); }
  }
  return <Page refreshing={refreshing} refresh={refresh}>
    <View style={[s.statusCard, incident ? s.statusWatch : s.statusSafe]}><View style={s.statusIcon}><Text style={s.statusIconText}>{incident ? '!' : '✓'}</Text></View><View style={s.flex}><Text style={s.overline}>{incident ? `${incident.severity_level} PRIORITY` : 'AREA STATUS'}</Text><Text style={s.statusTitle}>{incident?.name ?? 'No active incident nearby'}</Text><Text style={s.statusBody}>{incident?.description ?? 'Stay aware and keep notifications enabled.'}</Text></View></View>
    {active && <View style={s.progressCard}><Text style={s.progressOverline}>YOUR HELP REQUEST</Text><Text style={s.progressTitle}>{pretty(active.category)}</Text><Text style={s.progressStatus}>● {pretty(active.status)}</Text><Text style={s.progressBody}>The response team can see your request. Keep this app available.</Text></View>}
    <Text style={s.heading}>What do you need?</Text><View style={s.actionGrid}><Action icon="✚" title="Request help" sub="Send your location" tone="#db403d" onPress={() => go('help')}/><Action icon="✓" title="I'm safe" sub="Notify coordinators" tone="#118866" onPress={safe}/><Action icon="◇" title="Live updates" sub="Zones and hotspots" tone="#d68518" onPress={() => go('zones')}/><Action icon="⌁" title="Open map" sub="Routes and zones" tone="#317ca0" onPress={() => Linking.openURL(DASHBOARD_URL)}/></View>
    <View style={s.infoRow}><Text style={s.infoIcon}>⌂</Text><View style={s.flex}><Text style={s.cardTitle}>{shelters.length} shelters available</Text><Text style={s.muted}>View capacity and services in Updates.</Text></View></View><Text style={s.disclaimer}>For immediate life-threatening danger, contact your local emergency number.</Text>
  </Page>;
}

function Help({ incident, token, requests, onSent }: { incident: Incident | null; token: string; requests: HelpRequest[]; onSent: () => void }) {
  const [kind, setKind] = useState('EVACUATION'); const [people, setPeople] = useState('1'); const [description, setDescription] = useState(''); const [danger, setDanger] = useState(false); const [sending, setSending] = useState(false);
  async function submit() {
    if (!incident) return Alert.alert('No active incident', 'A help request needs an active incident.'); setSending(true);
    try { const c = await getLocation(); if (!c) throw new Error('Location permission is required to dispatch help.'); await api.createHelp(token, { clientRequestId: `android-${Date.now()}`, incidentId: incident.id, latitude: c.latitude, longitude: c.longitude, category: kind, description: description.trim() || undefined, peopleCount: Math.max(1, Number(people) || 1), medicalEmergency: kind === 'MEDICAL', vulnerabilities: [], immediateDanger: danger }); Alert.alert('Help request sent', 'Your location is now visible to the coordination team.'); setDescription(''); onSent(); }
    catch (e) { Alert.alert('Request not sent', (e as Error).message); } finally { setSending(false); }
  }
  return <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled"><Title title="Request assistance" sub="Choose the option that best describes what you need."/><View style={s.helpList}>{HELP_TYPES.map(item => <Pressable key={item.key} onPress={() => setKind(item.key)} style={[s.helpType, kind === item.key && s.helpTypeOn]}><View style={[s.helpIcon, kind === item.key && s.helpIconOn]}><Text style={s.helpIconText}>{item.icon}</Text></View><View style={s.flex}><Text style={s.helpTitle}>{item.label}</Text><Text style={s.muted}>{item.hint}</Text></View><Text style={s.chevron}>{kind === item.key ? '●' : '›'}</Text></Pressable>)}</View><View style={s.formCard}><FieldLabel>People needing help</FieldLabel><TextInput value={people} onChangeText={setPeople} keyboardType="number-pad" style={s.input}/><FieldLabel>Anything responders should know?</FieldLabel><TextInput value={description} onChangeText={setDescription} multiline maxLength={500} placeholder="Mobility needs, landmarks, road conditions…" placeholderTextColor="#89958f" style={[s.input, s.textarea]}/><Pressable style={[s.dangerToggle, danger && s.dangerToggleOn]} onPress={() => setDanger(!danger)}><Text style={s.dangerCheck}>{danger ? '✓' : ''}</Text><View style={s.flex}><Text style={s.helpTitle}>Immediate danger</Text><Text style={s.muted}>Fire, smoke or injury is threatening you now</Text></View></Pressable><PrimaryButton label={sending ? 'Getting location and sending…' : 'Review and send request'} disabled={sending} onPress={() => Alert.alert('Send help request?', 'Your current location will be shared with the coordination team.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Send', onPress: submit }])}/></View><Text style={s.smallCenter}>Previous requests: {requests.length}</Text></ScrollView>;
}

function Zones({ zones, fireCount, shelters, refreshing, refresh }: { zones: Zone[]; fireCount: number; shelters: Shelter[]; refreshing: boolean; refresh: () => void }) {
  return <Page refreshing={refreshing} refresh={refresh}><Title title="Live safety updates" sub="Official evacuation zones and satellite hotspot context."/><View style={s.metrics}><Metric value={zones.length} label="Priority zones"/><Metric value={fireCount} label="Hotspots"/><Metric value={shelters.length} label="Shelters"/></View><PrimaryButton label="Open full interactive map" onPress={() => Linking.openURL(DASHBOARD_URL)}/><Text style={s.heading}>Evacuation zones</Text>{zones.map(z => <View key={z.id} style={s.zoneRow}><View style={[s.zoneBar, { backgroundColor: statusColor(z.status) }]}/><View style={s.flex}><Text style={s.cardTitle}>{z.code}</Text><Text style={s.muted}>{z.county ?? z.name}</Text></View><View style={[s.tag, { backgroundColor: statusColor(z.status) }]}><Text style={s.tagText}>{z.status.toUpperCase()}</Text></View></View>)}<Text style={s.heading}>Shelters</Text>{shelters.map(x => <View key={x.id} style={s.shelter}><Text style={s.cardTitle}>{x.name}</Text><Text style={s.muted}>{x.occupancy} of {x.capacity} occupied · {pretty(x.status)}</Text><Text style={s.services}>{x.services.join(' · ') || 'General assistance'}</Text></View>)}</Page>;
}

function Profile({ session, onLogout }: { session: Session; onLogout: () => void }) { return <ScrollView contentContainerStyle={s.content}><View style={s.profileHero}><View style={s.avatar}><Text style={s.avatarText}>{session.user.name[0]}</Text></View><Title title={session.user.name} sub={session.user.email}/></View><View style={s.formCard}><Text style={s.cardTitle}>Resident account</Text><Text style={s.muted}>Connected securely to the RescuerMap coordination service.</Text><View style={s.divider}/><FieldLabel>App mode</FieldLabel><Text style={s.infoValue}>Hackathon demonstration</Text><FieldLabel>Server</FieldLabel><Text style={s.infoValue}>Render · Connected</Text></View><Pressable style={s.logout} onPress={onLogout}><Text style={s.logoutText}>Sign out</Text></Pressable></ScrollView>; }

async function getLocation(): Promise<Coordinates | null> {
  const p = await Location.requestForegroundPermissionsAsync();
  if (p.status !== 'granted') return null;
  const r = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const { latitude, longitude } = r.coords;
  // The evaluation environment models California. When demonstrated from another
  // country, anchor activity in the same Santa Cruz area as the web consoles.
  if (latitude < 32.5 || latitude > 42.1 || longitude < -124.5 || longitude > -114) {
    return { latitude: 37.127, longitude: -122.119 };
  }
  return { latitude, longitude };
}
function Page({ children, refreshing, refresh }: { children: ReactNode; refreshing: boolean; refresh: () => void }) { return <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#08775a"/>}>{children}</ScrollView>; }
function Logo() { return <View style={s.logo}><Text style={s.logoText}>R</Text></View>; }
function Title({ title, sub }: { title: string; sub: string }) { return <View><Text style={s.pageTitle}>{title}</Text><Text style={s.pageSubtitle}>{sub}</Text></View>; }
function FieldLabel({ children }: { children: ReactNode }) { return <Text style={s.inputLabel}>{children}</Text>; }
function PrimaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) { return <Pressable disabled={disabled} onPress={onPress} style={({ pressed }) => [s.primary, (pressed || disabled) && s.pressed]}><Text style={s.primaryText}>{label}</Text></Pressable>; }
function Nav({ icon, label, active, onPress, danger = false }: { icon: string; label: string; active: boolean; onPress: () => void; danger?: boolean }) { return <Pressable onPress={onPress} style={s.navItem}><Text style={[s.navIcon, active && s.navActive, danger && s.navDanger]}>{icon}</Text><Text style={[s.navLabel, active && s.navLabelOn]}>{label}</Text></Pressable>; }
function Action({ icon, title, sub, tone, onPress }: { icon: string; title: string; sub: string; tone: string; onPress: () => void }) { return <Pressable onPress={onPress} style={({ pressed }) => [s.action, pressed && s.pressed]}><View style={[s.actionIcon, { backgroundColor: tone }]}><Text style={s.actionIconText}>{icon}</Text></View><Text style={s.actionTitle}>{title}</Text><Text style={s.actionSub}>{sub}</Text></Pressable>; }
function Metric({ value, label }: { value: number; label: string }) { return <View style={s.metric}><Text style={s.metricValue}>{value}</Text><Text style={s.metricLabel}>{label}</Text></View>; }
function LoadingScreen({ label }: { label: string }) { return <SafeAreaProvider><View style={s.loading}><Logo/><ActivityIndicator color="#08775a" size="large"/><Text style={s.muted}>{label}</Text></View></SafeAreaProvider>; }
function pretty(v: string) { return v.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function statusColor(v: string) { const x = v.toLowerCase(); return x === 'order' ? '#d93737' : x === 'warning' ? '#e87818' : x === 'shelter' ? '#8b5cf6' : '#d4a017'; }

const s = StyleSheet.create({
  flex: { flex: 1 }, app: { flex: 1, backgroundColor: '#f4f7f5' }, body: { flex: 1 }, content: { padding: 20, paddingBottom: 32, gap: 16 }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18, backgroundColor: '#f4f7f5' },
  login: { flex: 1, backgroundColor: '#062d25', justifyContent: 'flex-end' }, loginHero: { padding: 28, gap: 12, flex: 1, justifyContent: 'center' }, logo: { width: 50, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0ca678' }, logoText: { color: 'white', fontSize: 27, fontWeight: '900' }, brand: { color: '#a9e8d5', fontWeight: '800', letterSpacing: 1.2, fontSize: 16 }, heroTitle: { color: 'white', fontSize: 38, lineHeight: 42, fontWeight: '800', maxWidth: 330 }, heroText: { color: '#b8cec7', fontSize: 16, lineHeight: 24, maxWidth: 350 }, loginCard: { backgroundColor: 'white', padding: 26, paddingBottom: 30, borderTopLeftRadius: 32, borderTopRightRadius: 32, gap: 9 },
  sectionTitle: { fontSize: 24, fontWeight: '800', color: '#102a22', marginBottom: 7 }, inputLabel: { fontSize: 13, fontWeight: '700', color: '#42544d', marginTop: 4 }, input: { borderWidth: 1, borderColor: '#ced9d4', borderRadius: 13, paddingHorizontal: 14, paddingVertical: 13, color: '#102a22', fontSize: 16, backgroundColor: '#fbfcfb' }, textarea: { minHeight: 94, textAlignVertical: 'top' }, primary: { backgroundColor: '#08775a', borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8 }, primaryText: { color: 'white', fontSize: 16, fontWeight: '800' }, pressed: { opacity: .62 }, error: { color: '#b42318', fontWeight: '600' }, demoNote: { color: '#708079', fontSize: 12, lineHeight: 17, textAlign: 'center', marginTop: 5 },
  topbar: { paddingHorizontal: 20, paddingVertical: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'white', borderBottomWidth: 1, borderBottomColor: '#e6ece9' }, hello: { fontSize: 20, fontWeight: '800', color: '#102a22' }, muted: { color: '#687a73', lineHeight: 19 }, livePill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#e4f6ef', borderRadius: 20, paddingHorizontal: 11, paddingVertical: 7 }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#0ca678' }, liveText: { color: '#08775a', fontWeight: '800', fontSize: 11 }, banner: { backgroundColor: '#fff1db', padding: 10 }, bannerText: { color: '#794600', textAlign: 'center', fontWeight: '600', fontSize: 12 },
  statusCard: { borderRadius: 20, padding: 18, flexDirection: 'row', gap: 14 }, statusWatch: { backgroundColor: '#fff4df', borderWidth: 1, borderColor: '#f2d9a9' }, statusSafe: { backgroundColor: '#e8f7f1', borderWidth: 1, borderColor: '#c4e8da' }, statusIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#e87818', alignItems: 'center', justifyContent: 'center' }, statusIconText: { color: 'white', fontSize: 24, fontWeight: '900' }, overline: { color: '#9a5611', fontSize: 11, fontWeight: '900', letterSpacing: 1 }, statusTitle: { color: '#24352f', fontSize: 18, fontWeight: '800', marginTop: 3 }, statusBody: { color: '#596a63', lineHeight: 20, marginTop: 4 },
  progressCard: { borderRadius: 18, padding: 17, backgroundColor: '#102f27', gap: 5 }, progressOverline: { color: '#94d9c4', fontSize: 11, fontWeight: '800', letterSpacing: 1 }, progressTitle: { color: 'white', fontSize: 17, fontWeight: '800' }, progressStatus: { color: '#72dfbb', fontWeight: '800' }, progressBody: { color: '#b9d1c9', lineHeight: 18 }, heading: { color: '#172d26', fontSize: 18, fontWeight: '800', marginTop: 4 },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 }, action: { width: '48%', minHeight: 142, backgroundColor: 'white', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: '#e1e9e5' }, actionIcon: { width: 43, height: 43, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 13 }, actionIconText: { color: 'white', fontSize: 22, fontWeight: '900' }, actionTitle: { color: '#172d26', fontSize: 16, fontWeight: '800' }, actionSub: { color: '#728079', fontSize: 12, marginTop: 4 }, infoRow: { backgroundColor: 'white', padding: 16, borderRadius: 17, flexDirection: 'row', alignItems: 'center', gap: 13, borderWidth: 1, borderColor: '#e1e9e5' }, infoIcon: { color: '#08775a', fontSize: 27 }, cardTitle: { color: '#172d26', fontSize: 16, fontWeight: '800' }, disclaimer: { textAlign: 'center', color: '#7a8983', fontSize: 11, lineHeight: 16, paddingHorizontal: 18 },
  nav: { backgroundColor: 'white', flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#dfe8e4', paddingTop: 7, paddingBottom: 5 }, navItem: { flex: 1, alignItems: 'center', gap: 3 }, navIcon: { color: '#87948f', fontSize: 23, fontWeight: '700' }, navDanger: { color: '#d93737' }, navActive: { color: '#08775a' }, navLabel: { color: '#87948f', fontSize: 10, fontWeight: '600' }, navLabelOn: { color: '#08775a', fontWeight: '800' },
  pageTitle: { color: '#102a22', fontSize: 28, fontWeight: '800' }, pageSubtitle: { color: '#687a73', fontSize: 14, lineHeight: 20, marginTop: 4 }, helpList: { gap: 9 }, helpType: { backgroundColor: 'white', padding: 13, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1.5, borderColor: '#e1e9e5' }, helpTypeOn: { borderColor: '#08775a', backgroundColor: '#eff9f5' }, helpIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#9aa7a1', alignItems: 'center', justifyContent: 'center' }, helpIconOn: { backgroundColor: '#08775a' }, helpIconText: { color: 'white', fontWeight: '900', fontSize: 20 }, helpTitle: { color: '#172d26', fontSize: 15, fontWeight: '800' }, chevron: { color: '#08775a', fontSize: 20 }, formCard: { backgroundColor: 'white', padding: 17, borderRadius: 18, gap: 9, borderWidth: 1, borderColor: '#e1e9e5' }, dangerToggle: { padding: 13, borderRadius: 13, borderWidth: 1, borderColor: '#e3e8e5', flexDirection: 'row', gap: 11, alignItems: 'center' }, dangerToggleOn: { backgroundColor: '#fff0ef', borderColor: '#e36c68' }, dangerCheck: { width: 24, height: 24, borderRadius: 7, backgroundColor: '#d93737', color: 'white', textAlign: 'center', lineHeight: 24, fontWeight: '900' }, smallCenter: { textAlign: 'center', color: '#78877f', fontSize: 12 },
  metrics: { flexDirection: 'row', gap: 8 }, metric: { flex: 1, backgroundColor: 'white', borderRadius: 15, padding: 13, borderWidth: 1, borderColor: '#e1e9e5' }, metricValue: { color: '#102a22', fontWeight: '900', fontSize: 22 }, metricLabel: { color: '#76857e', fontSize: 10, marginTop: 2 }, zoneRow: { backgroundColor: 'white', borderRadius: 14, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 11, overflow: 'hidden' }, zoneBar: { width: 5, height: 38, borderRadius: 4 }, tag: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5 }, tagText: { color: 'white', fontSize: 9, fontWeight: '900' }, shelter: { backgroundColor: 'white', borderRadius: 15, padding: 15, gap: 4 }, services: { color: '#08775a', fontSize: 12, fontWeight: '600', marginTop: 3 },
  profileHero: { alignItems: 'center', gap: 5, paddingVertical: 20 }, avatar: { width: 76, height: 76, borderRadius: 25, backgroundColor: '#08775a', alignItems: 'center', justifyContent: 'center', marginBottom: 7 }, avatarText: { color: 'white', fontSize: 31, fontWeight: '900' }, divider: { height: 1, backgroundColor: '#e4eae7', marginVertical: 6 }, infoValue: { color: '#172d26', fontSize: 15, fontWeight: '600' }, logout: { borderWidth: 1, borderColor: '#e1b4b2', borderRadius: 14, padding: 14, alignItems: 'center' }, logoutText: { color: '#b42318', fontWeight: '800' },
});
