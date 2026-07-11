/**
 * TakumiPay logo mark, inlined as base64 so the email module has no runtime
 * file-system or build-asset dependency (`nest build` does not copy .png
 * files into dist/ by default, and the Docker image only ships dist/).
 *
 * Source: mobile-app/assets/images/splash-icon-light.png, trimmed and resized
 * to 112x112 (rendered at 56px, so 2x for retina). Transparent background, so
 * it sits correctly on the white card and on a dark-mode inversion.
 *
 * Delivered as an inline attachment referenced by \`cid:\` rather than a
 * \`data:\` URI — Gmail and Outlook strip data URIs from <img src>, which
 * would render the logo as a broken image.
 */
export const LOGO_CONTENT_ID = "takumipay-logo";
export const LOGO_FILENAME = "takumipay-logo.png";

export const LOGO_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAHAAAABwCAYAAADG4PRLAAAPbklEQVR42u2de3BUVZ7HP/f2O+lH" +
  "QkIIbwkoGEVB5CWYEHQAnaAgWXGsssbacsadcsvdKmrddXdmdh1nd6umiprSmdpxx6rdqanZHd0J" +
  "DykRZhwTAiIgL1EJCmh4CCIhJP1I+nnv2T/uDYSQfiTdnZvu9KcqBf3I7d8535xzfud7zj0tkQAh" +
  "xEBPTwUWA7XAXP1xKWCjwGAIA53AWeAo0ALs0x9fQ5KkhBeJ+2o/8WRdrCeBVUAVYDe6BvKMEPAl" +
  "sAN4EzgMqL0vxhNywGf7iTcDeB5YD1QYXcpRQjvwBvAqcLr3yYFEvOmZPuKZgAbgx0C10SUapZwA" +
  "XgIaAYUBRLzhUR/xHMAG4AXAZXQpRjl+4GfARiBIPxGv/a+feC8DfwOYjY6+AAAx4BXgR/1FlLm5" +
  "29xQEG/EYdY12aBrdE0ziRsFXA+8Xug2Ryx+4Ht6lgqAqY94M4D/BCYaHWWBuNj0hPJPwFV6u1D9" +
  "3+eB242OsEBSqnWtZPoIOA94wujICqTMeuAe+gi4HhhrdFQFUqYC+A66gFOBh4yOqMCgWQVMlXVj" +
  "usroaAoMmipgsayvKhSM6dzDDtT2rjIUyE3m9o6BBXKTqZIQIlRYjM1ZwpKIs+xeIDeQM3CNAgZS" +
  "EDDHKQiY4xQEzHEKAuY4BQFznIKAOU5h34sqiLV3Ejn3DbGL7ShdAVAFssuBedwYLJPHYRlfhmSz" +
  "Gh3pgIxaAdVADz0HjuPfsZ+ew58R+7oDNRgCRd8MLctIVgvmMW5sM6dQvOwenMvvxTptvNGh38Co" +
  "c2JiV7oINB3Gu6mZ4JHPUQNBJFkCSf/pjyoQQkUymbBMHodnTQ0lT3wLy5RxRhcFRpOA0fPf4Nux" +
  "D9/W3YRb21AjMSRZTnB3yACoKiBhmzWVsr9uwF2/BMlibCeW3wKqgvDnZ/Fu24N/+14ibV9rXaQp" +
  "zdxNUZGLHZQ8tZLy59djKnEaVsS8FFBEogQ/OoV3UzOBPx8kdqlDe0HOYNItBEgS7voljHvpGcwV" +
  "Ywwpa14JqAaC9Oz7hK7GZnreP0as0399fMvahwpcDy+m8t9/gLm8ZNjLnBcCKh3ea4lJz+HPULuD" +
  "+viWReH6IgQl6x9k3MvfRy4a3t0pOT2NiJ7/Bv/O/Xi3tBBuPYMaiSLJMpLJNLQLCqH9QPysdEAk" +
  "ujY1Y62aSNlz64a1DnKvBaqC8Mlz+N7ajW/7B0TaLqafmAiBUAUmVxHmilIks4nYVR/KVZ+WeaYy" +
  "dqoCU7mHSa+9QNHi2cNWHTnTAkUkRvDYSXybd+F/9yCxr69oL8jy0MVTtUm7ubIM54Pzca9eim3G" +
  "JDCZUK500b33Y7yNTYSOt11LWuIiS8Tau7jyi0Ym3lGFyV08LPUy4lugGgjSs/9TvI1NdL9/jNhV" +
  "v3ZvnJzG+Ka3WOst43F9+z48j9RgmzVlwJYW+7qDjte20Pk/OxGhSNJuVTLJVP7bDyh5csWw1M+I" +
  "FVDp8BJo1hOTQxlITAQIVUWymrHffgvuR2twP7wYy5TK5L8ajdH539tp3/i/qN3BhDEIRaVo3iwm" +
  "//ZHmErdWa+nEdeFRs9fxr9zH96tuwkfb8tIYiJUFbnIQdE9M/GsW4Zz+b2Yx6ae8ksWM2OeWY0a" +
  "DHHl528gFDX+e00yoeNf0r33Y9z1S7NeXyNDQNGbmOzB9/beGxITaajjW29iUuKkeMldeBqWU3zf" +
  "bGRX0dCuJ8uM+d6jhD87h2/b7oSJjRoM49+xH9eqxUjmIf7hpYihAopojNCx03g3N+N/90NiFzOY" +
  "mIwrw/nAvXjWLcMxdyaSzZJ2vHKRnbLn1tFzqJXYxY6447AkywSPfEb0QjvWqcm76HQwREC1J0TP" +
  "geN4/9BE956PiHX49MQkjalAb2IybQKuh+/DvaYG+6ypmbXPAPudVbjrl3L111vjn5MkS8QuXSV8" +
  "4kx+Cah0+enedZSuxiaCH7aiBHr08W2o3WSfxOSOKtxranA9tDjrleauX4L3/95D8QbiJjRqOEro" +
  "xBlcqxZlNZZhETB2qQP/Hw/g3byL0CdfoIYiSLKUocTkNjzr6gadmKSDbeYUrLdOpufDViRTnFYo" +
  "BNG2i6CK9KY8SciqgJG2i/je3ovvrd2ET55HxBSkdBITtFYnFzsorpmTfmIyRGRnEbbbJtNz4Hj8" +
  "N0na4rGIRrO6HSPzAqoqodYz+La24HtnH9FzlzQXI52usi9CxTK1ksqfPot5nDFLOID22QnnpBJq" +
  "TxgRVZCyeOtQRgWMXrxCx39swr/9A2KXr2p/hplezpFlIl9coOfQCdzfXpK9mklGSmXKvkeSsRRN" +
  "6fBy6cVfcfW/3ibW3qllf1nq+9VgCO8fmlFD4axXUDxilzqur1wMiEB22LM+D8yYgN5Nuwg0HdK6" +
  "yaG0OCEQiopktSBZE3cMkizTs/9Tgoc+y2rlxEO56iP0yZeJD2MVYCr3IFnTn38mIiMCinCEwO6j" +
  "iJgyhF/WhJNdRbhXLWLiLzfgWVd3bUI+IJKE4gvgbWwe2memSaD5MOHPzyY0GyRJwlY1MasZKJka" +
  "A0UkhtLpH1zLU7XFU1NFKc66eXga6iiaNwvJbsVcWYZ/535tPU6K73YEdh0mfLwN+90zslpJfYmc" +
  "/oqO17YgwpGEJoHksGKfPT3r8WREQMlm0eZgqSxsqCpIEpbJFbhWLcKzdhm2O6fdMCe031lFcc1c" +
  "vJub488VJQnlchferS3DJmD49Fdc+sdfEW49k9jhUVUskyux35n901syI6DVgvOB+QSaDmsta6BG" +
  "o6hgNmG7bQruR+/Hvfp+rNMHPldPspjxNNQRePcAancofsuWJPw791P61CqsVdk7o0/1dRNoPsyV" +
  "XzYSbm1Las8JAc5lczFXlmUtpl4yNo1wP3o/PQc+xbd1NyjX3Qehqsg2K/Y5t+J+bBmulYuwTChP" +
  "er2iBdU45lcTaDoc3+2QJW3D7tt7KX/+8YxXTuxKF4E/H8Tb2Ezw6ElEKJzcWxUCc0Up7jW1GY9n" +
  "IDImoMldTOVPvo9txmR82/cS+6YTyWrGNusWPGtrcNbNwzQm9QVOuchOScNyevZ+nDhREQLftvcp" +
  "efxBzJWZmdhHL7Tjf+cDvFtaCB1vQ0T1XdypGONC4Flbi+Ou4enWs7IiH7viRWnv1MbG8eXIjqFZ" +
  "EUqnn/NPv0zPwROJXRxJovJf/4rSp1alFXfk9Fd4t+3Bt20PkS8uDHqzlFBUHHfPYNLrL2KZNDwH" +
  "/GfFCzWXezCXe9K+jqnUhWdtLcGjJxMmSCKm4N28C/cjSzF5BrfNXSgq4dY2vJt34d+xj+j5y7rh" +
  "Osg1SVXFUjmGihe/O2ziYfSCbio4VyzE9tsd2rwrThcmmWRCx07RvecY7vrU7DURiRI88jnexmYC" +
  "7x0kdrnzuvU3qDteNPFMJS4q/ulpimvmDGv9jHgBLRPKca9eSvvn5xK+Tw2F8TY24XzwXmR74i47" +
  "cvor2l95k8B7h1C6Atr2+yEu/ApFxVJZRsUPn8azdngSl77kxC3WrvolWCaN1aYocdDsteMEDya2" +
  "16IX2rn4d7/A29iM6utOy/pDVXHMuZUJr/wtnseWDd9W/j7khIC2GZNwrlxIwnyr117blNhe6/r9" +
  "uwQ/bNVM5qFUuKpZf6ZSN6V/uZpJv/4Hiu8f3m6zLyO+CwVNHM/aZfi27k5urzXHt9fU7iDdez9G" +
  "CDHYUe76ZqkJ5bhWLMSzrg773bdmZo0zDXJDQMA+ezrFtffg3dSU2F5rj2+viVBU6zYH5dmqIOmb" +
  "peqX4llTg23mFEO6y4HIGQEls4mShjoCfzqQeHd0AntNKrZhrigl1NqGlMxQUVQkswlb9TQ8a2pw" +
  "1S/N+mapoZATY2AvjvnVFC2oRiRaaupjr930kt2Gc8UC7b72gYZTcV24ovm3U/nTZ5nyu3+h7LmG" +
  "ESkeudQCAeQiG56GOm0ci8biv1EIfNv2UPL4AzcZyp51dYSOnMS7ZRdCEdoUQgiEENpmqfnVeP5i" +
  "Oc66ezCVjPxvIBqxN7fEQ+nyc/67qdprz1L61EMDXqPrd3/E984HxL65imSz4rhrOp51dRTdNxu5" +
  "2GF0MVMm5wQE6PzNdi79+PXE9pqiUrTwDib/5odx7TWl04/S6dc824pSw48MGQo5NQb24ly5ULsR" +
  "U01yl9CxU3Tv+Sjue0ylLqxVE7BMHJuT4pGrAlrGa/ZaslReDYW13WtB43avZZucFBDAtXoplokp" +
  "2GsHPiV48ITR4WaNnBXQNn0izpWLUrDXupPaa7lMzgqo2Wu12rqjSNwKA7uOEPr0S6Mjzgq5K+A1" +
  "e21u4om9bq/5trYYHW5WyGkBNXttOSZXceItjbq9FvnigtEhZ5ycFhDAsaCaooV3JLfXvrqM7+33" +
  "jQ434+S8gLLDhmddXdJV+N7da7GvO4wOObPlNzqATFBcOwf77OkJj/9AlgmfOo//3QNGh5tR8kJA" +
  "U4kLz2PLkt7Kpe1ea9EONs8T8kJAAOeKBanZax+fpnv3UaPDzRh5I6BlfDnuR1K01zblj72WNwIC" +
  "uOuXaptqU9q9lh/2Wl4JaJ0+CdfKRUnnhIo/f+y1vBIQCdxrazEluVdRkmUCLUcJnzhjdMRpk18C" +
  "6jeHOlOx1650EfzolNHhpk3eCSiZTXhSsddUoe1uy3HyTkAAx/zbk9prks2CdYR8fU465KWAssNG" +
  "yXe+pW1OGqAVipiC/c4qHPOrjQ41/bIaHUC2cD4wnzHPPIJks2rZpqIiFBURU7BNn8jYv39q2A7H" +
  "yyY5uSstVUQ4qh3f/NYeoucuIVktOObOpOTJFdjvmGZ0eBkhrwXsRUSiqIEgmEyY3EUj5r6GTDAq" +
  "BMxn8nYMHC3IQH64uqOTsAx0Gh1FgSHTKQNnjY6iwJA5KwP5s7o5+jgqAy1AyOhICgyaENAiA/uA" +
  "/Ny2nN98CezrHQN3Gh1NgUGzo3cMBPg9cNnoiAqkTDvwJn0m8kd6nyiQE7wBHKaPgCrwKtBqdGQF" +
  "knJC10qln5V2GvgJ4Dc6wgJx8QMv6VohSRJyv1OLGoGfAbEhf0SBbBHTtWns+6SMrqSOAmwEXimI" +
  "OKKI6Zps1DW6ptkNza/PypID2AC8AIz8027yG7/e8jYCQW5scDcf2tdHRBPQAPwzcLvRpRiltOp5" +
  "SWP/ltfLgEvT/dZ4ZwDPA08AY40u0Sjhsj6te7U3YWEA8Uh0OHQ/EWVgHrAeeAioAuxGlzLPCOn2" +
  "2E7dWDnSO1Ugjnikcrr3ADsupgKLgVpgrv64FMji1xzmJWF9LfasviLUovvSNy3vJTrf9P8BGb3l" +
  "C5zhvqEAAAAASUVORK5CYII=";
