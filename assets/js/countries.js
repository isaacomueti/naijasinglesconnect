/*
 * Every country and territory with its international dialling code, grouped by region.
 * Used by the phone picker on /auth and the Nationality field on /dashboard.
 * [ISO 3166 alpha-2, name, dialling code]
 */
(function () {
  'use strict';
  var REGIONS = [
    ['Africa', [
      ['DZ','Algeria','+213'],['AO','Angola','+244'],['BJ','Benin','+229'],['BW','Botswana','+267'],['BF','Burkina Faso','+226'],['BI','Burundi','+257'],
      ['CV','Cabo Verde','+238'],['CM','Cameroon','+237'],['CF','Central African Republic','+236'],['TD','Chad','+235'],['KM','Comoros','+269'],
      ['CG','Congo','+242'],['CD','DR Congo','+243'],['CI',"Côte d'Ivoire",'+225'],['DJ','Djibouti','+253'],['EG','Egypt','+20'],['GQ','Equatorial Guinea','+240'],
      ['ER','Eritrea','+291'],['SZ','Eswatini','+268'],['ET','Ethiopia','+251'],['GA','Gabon','+241'],['GM','Gambia','+220'],['GH','Ghana','+233'],['GN','Guinea','+224'],
      ['GW','Guinea-Bissau','+245'],['KE','Kenya','+254'],['LS','Lesotho','+266'],['LR','Liberia','+231'],['LY','Libya','+218'],['MG','Madagascar','+261'],
      ['MW','Malawi','+265'],['ML','Mali','+223'],['MR','Mauritania','+222'],['MU','Mauritius','+230'],['YT','Mayotte','+262'],['MA','Morocco','+212'],
      ['MZ','Mozambique','+258'],['NA','Namibia','+264'],['NE','Niger','+227'],['NG','Nigeria','+234'],['RE','Réunion','+262'],['RW','Rwanda','+250'],
      ['SH','Saint Helena','+290'],['ST','São Tomé and Príncipe','+239'],['SN','Senegal','+221'],['SC','Seychelles','+248'],['SL','Sierra Leone','+232'],
      ['SO','Somalia','+252'],['ZA','South Africa','+27'],['SS','South Sudan','+211'],['SD','Sudan','+249'],['TZ','Tanzania','+255'],['TG','Togo','+228'],
      ['TN','Tunisia','+216'],['UG','Uganda','+256'],['EH','Western Sahara','+212'],['ZM','Zambia','+260'],['ZW','Zimbabwe','+263']
    ]],
    ['Europe', [
      ['AX','Åland Islands','+358'],['AL','Albania','+355'],['AD','Andorra','+376'],['AT','Austria','+43'],['BY','Belarus','+375'],['BE','Belgium','+32'],
      ['BA','Bosnia and Herzegovina','+387'],['BG','Bulgaria','+359'],['HR','Croatia','+385'],['CY','Cyprus','+357'],['CZ','Czechia','+420'],['DK','Denmark','+45'],
      ['EE','Estonia','+372'],['FO','Faroe Islands','+298'],['FI','Finland','+358'],['FR','France','+33'],['DE','Germany','+49'],['GI','Gibraltar','+350'],
      ['GR','Greece','+30'],['GG','Guernsey','+44'],['HU','Hungary','+36'],['IS','Iceland','+354'],['IE','Ireland','+353'],['IM','Isle of Man','+44'],
      ['IT','Italy','+39'],['JE','Jersey','+44'],['XK','Kosovo','+383'],['LV','Latvia','+371'],['LI','Liechtenstein','+423'],['LT','Lithuania','+370'],
      ['LU','Luxembourg','+352'],['MT','Malta','+356'],['MD','Moldova','+373'],['MC','Monaco','+377'],['ME','Montenegro','+382'],['NL','Netherlands','+31'],
      ['MK','North Macedonia','+389'],['NO','Norway','+47'],['PL','Poland','+48'],['PT','Portugal','+351'],['RO','Romania','+40'],['RU','Russia','+7'],
      ['SM','San Marino','+378'],['RS','Serbia','+381'],['SK','Slovakia','+421'],['SI','Slovenia','+386'],['ES','Spain','+34'],['SE','Sweden','+46'],
      ['CH','Switzerland','+41'],['UA','Ukraine','+380'],['GB','United Kingdom','+44'],['VA','Vatican City','+39']
    ]],
    ['North America', [
      ['CA','Canada','+1'],['GL','Greenland','+299'],['MX','Mexico','+52'],['PM','Saint Pierre and Miquelon','+508'],['US','United States','+1']
    ]],
    ['Caribbean', [
      ['AI','Anguilla','+1264'],['AG','Antigua and Barbuda','+1268'],['AW','Aruba','+297'],['BS','Bahamas','+1242'],['BB','Barbados','+1246'],['BM','Bermuda','+1441'],
      ['BQ','Bonaire','+599'],['VG','British Virgin Islands','+1284'],['KY','Cayman Islands','+1345'],['CU','Cuba','+53'],['CW','Curaçao','+599'],['DM','Dominica','+1767'],
      ['DO','Dominican Republic','+1809'],['GD','Grenada','+1473'],['GP','Guadeloupe','+590'],['HT','Haiti','+509'],['JM','Jamaica','+1876'],['MQ','Martinique','+596'],
      ['MS','Montserrat','+1664'],['PR','Puerto Rico','+1787'],['BL','Saint Barthélemy','+590'],['KN','Saint Kitts and Nevis','+1869'],['LC','Saint Lucia','+1758'],
      ['MF','Saint Martin','+590'],['VC','Saint Vincent and the Grenadines','+1784'],['SX','Sint Maarten','+1721'],['TT','Trinidad and Tobago','+1868'],
      ['TC','Turks and Caicos Islands','+1649'],['VI','US Virgin Islands','+1340']
    ]],
    ['Central and South America', [
      ['AR','Argentina','+54'],['BZ','Belize','+501'],['BO','Bolivia','+591'],['BR','Brazil','+55'],['CL','Chile','+56'],['CO','Colombia','+57'],['CR','Costa Rica','+506'],
      ['EC','Ecuador','+593'],['SV','El Salvador','+503'],['FK','Falkland Islands','+500'],['GF','French Guiana','+594'],['GT','Guatemala','+502'],['GY','Guyana','+592'],
      ['HN','Honduras','+504'],['NI','Nicaragua','+505'],['PA','Panama','+507'],['PY','Paraguay','+595'],['PE','Peru','+51'],['SR','Suriname','+597'],
      ['UY','Uruguay','+598'],['VE','Venezuela','+58']
    ]],
    ['Middle East', [
      ['BH','Bahrain','+973'],['IR','Iran','+98'],['IQ','Iraq','+964'],['IL','Israel','+972'],['JO','Jordan','+962'],['KW','Kuwait','+965'],['LB','Lebanon','+961'],
      ['OM','Oman','+968'],['PS','Palestine','+970'],['QA','Qatar','+974'],['SA','Saudi Arabia','+966'],['SY','Syria','+963'],['TR','Turkey','+90'],
      ['AE','United Arab Emirates','+971'],['YE','Yemen','+967']
    ]],
    ['Asia', [
      ['AF','Afghanistan','+93'],['AM','Armenia','+374'],['AZ','Azerbaijan','+994'],['BD','Bangladesh','+880'],['BT','Bhutan','+975'],['IO','British Indian Ocean Territory','+246'],
      ['BN','Brunei','+673'],['KH','Cambodia','+855'],['CN','China','+86'],['GE','Georgia','+995'],['HK','Hong Kong','+852'],['IN','India','+91'],['ID','Indonesia','+62'],
      ['JP','Japan','+81'],['KZ','Kazakhstan','+7'],['KG','Kyrgyzstan','+996'],['LA','Laos','+856'],['MO','Macau','+853'],['MY','Malaysia','+60'],['MV','Maldives','+960'],
      ['MN','Mongolia','+976'],['MM','Myanmar','+95'],['NP','Nepal','+977'],['KP','North Korea','+850'],['PK','Pakistan','+92'],['PH','Philippines','+63'],
      ['SG','Singapore','+65'],['KR','South Korea','+82'],['LK','Sri Lanka','+94'],['TW','Taiwan','+886'],['TJ','Tajikistan','+992'],['TH','Thailand','+66'],
      ['TL','Timor-Leste','+670'],['TM','Turkmenistan','+993'],['UZ','Uzbekistan','+998'],['VN','Vietnam','+84']
    ]],
    ['Oceania', [
      ['AS','American Samoa','+1684'],['AU','Australia','+61'],['CX','Christmas Island','+61'],['CC','Cocos (Keeling) Islands','+61'],['CK','Cook Islands','+682'],
      ['FJ','Fiji','+679'],['PF','French Polynesia','+689'],['GU','Guam','+1671'],['KI','Kiribati','+686'],['MH','Marshall Islands','+692'],['FM','Micronesia','+691'],
      ['NR','Nauru','+674'],['NC','New Caledonia','+687'],['NZ','New Zealand','+64'],['NU','Niue','+683'],['NF','Norfolk Island','+672'],['MP','Northern Mariana Islands','+1670'],
      ['PW','Palau','+680'],['PG','Papua New Guinea','+675'],['WS','Samoa','+685'],['SB','Solomon Islands','+677'],['TK','Tokelau','+690'],['TO','Tonga','+676'],
      ['TV','Tuvalu','+688'],['VU','Vanuatu','+678'],['WF','Wallis and Futuna','+681']
    ]]
  ];
  // Pinned at the top: where most NSC members and diaspora live
  var POPULAR = ['NG','GB','US','CA','GH','IE','ZA','AE','DE'];

  var all = [], byIso = {};
  REGIONS.forEach(function (r) {
    r[1].forEach(function (c) { var o = { iso: c[0], name: c[1], dial: c[2], region: r[0] }; all.push(o); byIso[o.iso] = o; });
  });
  window.NSC_COUNTRIES = {
    regions: REGIONS.map(function (r) { return { name: r[0], countries: r[1].map(function (c) { return byIso[c[0]]; }) }; }),
    popular: POPULAR.map(function (i) { return byIso[i]; }),
    all: all.slice().sort(function (a, b) { return a.name.localeCompare(b.name); }),
    byIso: byIso,
    /* match by name, ISO code or dialling code ("+44", "44", "uk") */
    search: function (q) {
      q = String(q || '').trim().toLowerCase(); if (!q) return [];
      var digits = q.replace(/[^\d]/g, ''), alias = { uk: 'GB', usa: 'US', america: 'US', uae: 'AE', drc: 'CD', 'ivory coast': 'CI', holland: 'NL', england: 'GB', scotland: 'GB', wales: 'GB' };
      return all.map(function (c) {
        var n = c.name.toLowerCase(), s = 0;
        if (alias[q] === c.iso) s = 100;
        else if (n === q || c.iso.toLowerCase() === q) s = 90;
        else if (n.indexOf(q) === 0) s = 80;
        else if (n.split(/[\s-]/).some(function (w) { return w.indexOf(q) === 0; })) s = 70;
        else if (digits && digits.length === q.replace(/[+\s]/g, '').length && c.dial.slice(1).indexOf(digits) === 0) s = 60 - (c.dial.length - digits.length - 1);
        else if (n.indexOf(q) > 0) s = 40;
        if (s && POPULAR.indexOf(c.iso) >= 0) s += 5;
        return { c: c, s: s };
      }).filter(function (x) { return x.s > 0; }).sort(function (a, b) { return b.s - a.s || a.c.name.localeCompare(b.c.name); }).map(function (x) { return x.c; });
    }
  };
})();
