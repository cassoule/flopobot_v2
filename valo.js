export async function getValorantSkins(locale='fr-FR') {
    const response = await fetch(`https://valorant-api.com/v1/weapons/skins?language=${locale}`, { method: 'GET' });
    const data = await response.json();
    return data.data
}

export async function getSkinTiers(locale='fr-FR') {
    const response = await fetch(`https://valorant-api.com/v1/contenttiers?language=${locale}`, { method: 'GET'});
    const data = await response.json();
    return data.data
}