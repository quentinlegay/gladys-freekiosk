# FreeKiosk pour Gladys Assistant

Cette intégration découvre les tablettes Android qui font tourner
[FreeKiosk](https://freekiosk.app) (application kiosque open source) sur votre
réseau local, et les pilote depuis Gladys via l'API REST intégrée à FreeKiosk :
écran, économiseur d'écran, luminosité, volume, page affichée, synthèse vocale,
messages, redémarrage... Aucun compte, aucun cloud : Gladys parle directement
aux tablettes.

## 1. Préparer chaque tablette

1. Installez FreeKiosk (2.0 ou plus récent recommandé).
2. Ouvrez les réglages : 5 appuis sur le bouton secret, puis votre code PIN.
3. Onglet **Avancé** > **API REST** :
   - activez **Enable REST API** ;
   - activez **Allow remote control** (sinon la tablette refuse les commandes
     avec une erreur 403) ;
   - notez le **port** (8080 par défaut) ;
   - définissez une **clé d'API** (recommandé) et notez-la.
4. Donnez à la tablette une **adresse IP fixe** (réservation DHCP sur votre
   box ou votre routeur). L'intégration suit une tablette qui change d'adresse
   (voir plus bas), mais une adresse fixe évite toute surprise.

> Certaines commandes demandent plus de droits sur la tablette : l'extinction
> réelle de l'écran et le verrouillage passent par le mode **Device Owner**,
> **Device Admin** ou le **service d'accessibilité** de FreeKiosk ; le
> redémarrage de la tablette exige le mode **Device Owner**. Sans eux, « Écran
> éteint » baisse la luminosité à 0. Voir la
> [documentation de FreeKiosk](https://github.com/RushB-fr/freekiosk/blob/main/docs/rest-api.md).

## 2. Configurer l'intégration

Dans Gladys, **Intégrations** > **FreeKiosk** > **Configuration** :

| Champ                          | Rôle                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Clé d'API                      | La clé définie dans FreeKiosk, commune à vos tablettes. Vide si elles n'en ont pas.                                                        |
| Adresses à scanner             | Où chercher les tablettes : `192.168.1.0/24`, `192.168.1.20-192.168.1.60`, `192.168.1.50`... séparés par des virgules (1024 adresses max). |
| Port de l'API REST             | Port scanné, et port par défaut des tablettes ajoutées par IP (8080).                                                                      |
| Intervalle de rafraîchissement | Fréquence de lecture de l'état des tablettes, en secondes (15 minimum, 30 par défaut).                                                     |
| Caméra de la tablette          | Ajoute une caméra (frontale ou arrière) aux tablettes créées ensuite. Désactivée par défaut.                                               |

## 3. Découvrir les tablettes

Deux façons, combinables :

- **Scan du réseau** : renseignez les _Adresses à scanner_, puis cliquez sur
  **Scanner le réseau** (ou ouvrez l'onglet **Découverte** de l'intégration).
  Chaque adresse est interrogée sur le port configuré ; une tablette FreeKiosk
  se reconnaît même quand elle a une clé d'API.
- **Ajout par IP** : action **Ajouter une tablette par IP**, avec l'adresse,
  le port si différent, la clé si elle diffère de la clé commune, et un nom
  facultatif. L'action vérifie que la tablette répond avant de l'ajouter.

Les tablettes trouvées apparaissent dans l'onglet **Découverte** : créez-les
pour les ajouter à Gladys (vous pouvez les renommer et choisir leur pièce).

> Le conteneur de l'intégration ne voit pas le multicast du réseau local (et
> FreeKiosk ne s'annonce pas en mDNS) : c'est pourquoi le scan a besoin de la
> plage d'adresses à interroger.

## 4. Ce que vous pouvez faire

Chaque tablette devient un appareil avec :

| Fonctionnalité                                                                                               | Type                      |
| ------------------------------------------------------------------------------------------------------------ | ------------------------- |
| Écran allumé / éteint                                                                                        | Interrupteur              |
| Économiseur d'écran activé / désactivé                                                                       | Interrupteur              |
| Luminosité (0-100 %)                                                                                         | Variateur                 |
| Luminosité automatique                                                                                       | Interrupteur              |
| Volume (0-100 %)                                                                                             | Volume                    |
| Batterie, en charge, température de la batterie, luminosité ambiante                                         | Capteurs                  |
| Page affichée                                                                                                | Texte (lecture seule)     |
| Ouvrir une URL, Parler (synthèse vocale), Afficher un message                                                | Texte (écrire = exécuter) |
| Recharger la page, Réveiller, Vider le cache, Redémarrer FreeKiosk, Verrouiller, Redémarrer la tablette, Bip | Boutons                   |
| Caméra (photo prise à la demande), si activée                                                                | Caméra                    |

L'état est relu à l'intervalle choisi, et juste après chaque commande. Une
tablette injoignable est signalée par un badge « injoignable » ; une tablette
qui refuse la clé d'API par un point orange.

### Scènes

- **Déclencheur « Tablette en ligne / hors ligne »** : quand une tablette cesse
  ou recommence de répondre (filtrable par tablette et par état ; variable
  `status`).
- **Actions** : _Ouvrir une URL sur une tablette_, _Faire parler une tablette_
  (avec la langue, ex. `fr-FR`), _Afficher un message_, _Jouer un son_ (URL
  d'un fichier audio, volume, en boucle) et _Arrêter le son_.
- Les fonctionnalités de l'appareil (écran, luminosité...) se pilotent aussi
  avec l'action standard « Contrôler un appareil ».

### Widgets du tableau de bord

- **Tablette FreeKiosk** : choisissez une tablette dans les réglages du widget.
  Il affiche en direct sa batterie, sa luminosité et son volume, son état
  (connexion, écran, page affichée, alimentation) et quatre boutons : allumer /
  éteindre l'écran, recharger la page, ouvrir une URL et faire parler la
  tablette (un petit formulaire s'ouvre). Les boutons sont masqués quand la
  tablette est injoignable.
- **Tablettes FreeKiosk** : toutes vos tablettes (10 au plus) avec leur
  connexion et leur batterie, le nombre de tablettes en ligne, et un bouton
  **Scanner le réseau**.

## 5. Actions de la page Configuration

| Action                              | Usage                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| Scanner le réseau                   | Rafraîchit les tablettes connues et cherche les nouvelles.                                 |
| Ajouter une tablette par IP         | Ajoute une tablette sans scan.                                                             |
| Définir la clé d'API d'une tablette | Pour une tablette dont la clé diffère de la clé commune (vide = revenir à la clé commune). |
| Changer l'adresse d'une tablette    | La tablette a changé d'IP : l'appareil, son historique et ses scènes sont conservés.       |
| Identifier une tablette             | La tablette se réveille, bipe et affiche « Gladys 👋 ».                                    |

## 6. Bon à savoir

- **Identifiant des tablettes.** L'API de FreeKiosk n'expose aucun identifiant
  matériel : l'intégration attribue à chaque tablette un identifiant à sa
  découverte et le garde pour toujours. Quand le scan retrouve une tablette à
  une nouvelle adresse alors que l'ancienne ne répond plus, il la reconnaît
  (même modèle, seule candidate) et met son adresse à jour. Sinon, utilisez
  **Changer l'adresse d'une tablette**.
- **Caméra.** L'option ne s'applique qu'aux tablettes créées après son
  activation (les fonctionnalités d'un appareil sont fixées à sa création :
  supprimez puis recréez la tablette pour l'ajouter). La photo est compressée
  pour tenir dans la limite de 150 Ko de Gladys. Elle échoue si la détection
  de mouvement de FreeKiosk utilise déjà la caméra.
- **Supprimer une tablette** dans Gladys l'oublie : un scan ultérieur la
  retrouvera comme nouvelle tablette.
- **Sécurité.** L'API REST de FreeKiosk est en HTTP simple : gardez les
  tablettes sur un réseau de confiance et définissez une clé d'API. La clé
  n'apparaît jamais dans les URL ni dans les logs de l'intégration.

## Dépannage

| Symptôme                          | Piste                                                                                                    |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Le scan ne trouve rien            | API REST activée ? Bon port ? La plage contient-elle l'IP de la tablette ? Tablette sur le même réseau ? |
| « a refusé la clé d'API »         | Vérifiez la clé dans FreeKiosk > Avancé > API REST, ou utilisez « Définir la clé d'API d'une tablette ». |
| « remote control is disabled »    | Activez « Allow remote control » dans FreeKiosk.                                                         |
| L'écran ne s'éteint pas vraiment  | Activez Device Owner, Device Admin ou le service d'accessibilité de FreeKiosk.                           |
| « Redémarrer la tablette » échoue | Nécessite le mode Device Owner.                                                                          |
